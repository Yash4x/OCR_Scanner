import { randomUUID } from "crypto";
import { OpenAI } from "openai";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import type { DocumentBlockType, DocumentLineRecord, DocumentOutputRecord, DocumentOutputType, DocumentPageRecord } from "@/lib/types";

export interface OCRLine {
  line_number: number;
  text: string;
  normalized_text: string;
  section_title: string | null;
  block_type: DocumentBlockType;
  bbox_top: number | null;
  bbox_left: number | null;
  bbox_width: number | null;
  bbox_height: number | null;
  confidence: number | null;
}

export interface OCRPageResult {
  page_number: number;
  lines: OCRLine[];
}

export interface DocumentPageImage {
  pageNumber: number;
  imageBuffer: Buffer;
  mimeType: string;
  width: number | null;
  height: number | null;
}

type PdfCanvasFactory = {
  create(width: number, height: number): {
    canvas: { toBuffer(format: string): Buffer };
    context: unknown;
  };
  destroy(canvasAndContext: { canvas: { toBuffer(format: string): Buffer }; context: unknown }): void;
};

let canvasModulePromise: Promise<typeof import("@napi-rs/canvas")> | null = null;

const pdfjsWorkerGlobal = globalThis as typeof globalThis & {
  pdfjsWorker?: {
    WorkerMessageHandler: typeof WorkerMessageHandler;
  };
};

if (!pdfjsWorkerGlobal.pdfjsWorker) {
  pdfjsWorkerGlobal.pdfjsWorker = {
    WorkerMessageHandler,
  };
}

async function getCanvasModule() {
  canvasModulePromise ||= import("@napi-rs/canvas");
  return canvasModulePromise;
}

const PDFJS_ASSET_BASE_PATH = `${process.cwd()}/node_modules/pdfjs-dist/`;
const PDFJS_CMAP_URL = `${PDFJS_ASSET_BASE_PATH}cmaps/`;
const PDFJS_STANDARD_FONT_DATA_URL = `${PDFJS_ASSET_BASE_PATH}standard_fonts/`;

const OCR_SYSTEM_PROMPT = `You are an OCR and document reconstruction engine. Extract the visible text from this scanned document page. Preserve reading order from top to bottom. Keep line breaks close to the original document. Identify headings, paragraph lines, table rows, signatures, headers, and footers. Return only valid JSON. Do not add explanations.

Return this JSON structure:

{
"page_number": number,
"lines": [
{
"line_number": number,
"text": string,
"normalized_text": string,
"section_title": string or null,
"block_type": "heading" | "paragraph" | "table_row" | "signature" | "footer" | "header" | "unknown",
"bbox_top": number or null,
"bbox_left": number or null,
"bbox_width": number or null,
"bbox_height": number or null,
"confidence": number or null
}
]
}

Important:

Do not hallucinate missing text.
If text is unreadable, mark it as "[unclear]".
Keep dollar amounts, dates, names, addresses, and legal terms exact.
Preserve table rows as single logical rows when possible.
Do not summarize.
Extract only what is visible on the page.`;

export function normalizeExtractedText(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function buildPlainTextOutput(pageLines: OCRPageResult[]) {
  return pageLines
    .map((page) => {
      const lines = page.lines.map((line) => `Line ${line.line_number}: ${line.text}`);
      return [`Page ${page.page_number}`, ...lines].join("\n");
    })
    .join("\n\n");
}

export function buildMarkdownOutput(pageLines: OCRPageResult[]) {
  return pageLines
    .map((page) => {
      const lines = page.lines.map((line) => line.text);
      return [`Page ${page.page_number}`, ...lines].join("\n\n");
    })
    .join("\n\n");
}

export function createDocumentOutputPath(
  userId: string,
  comparisonId: string,
  documentRole: "old" | "new",
  outputType: DocumentOutputType,
) {
  return `${userId}/${comparisonId}/${documentRole}/recreated.${outputType === "markdown" ? "md" : outputType}`;
}

export function createPageImagePath(userId: string, comparisonId: string, documentRole: "old" | "new", pageNumber: number) {
  return `${userId}/${comparisonId}/${documentRole}/pages/page-${String(pageNumber).padStart(3, "0")}.png`;
}

export function toDataUrl(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

export async function renderPdfPages(buffer: Buffer): Promise<DocumentPageImage[]> {
  console.log(`[pdf] start render ${buffer.length} bytes`);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: PDFJS_CMAP_URL,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL,
    useSystemFonts: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  });

  console.log(`[pdf] waiting for loading task`);
  const pdfDocument = await loadingTask.promise;
  console.log(`[pdf] loaded document with ${pdfDocument.numPages} page(s)`);
  const pages: DocumentPageImage[] = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    console.log(`[pdf] loading page ${pageNumber}`);
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    console.log(`[pdf] rendering page ${pageNumber} at ${Math.ceil(viewport.width)}x${Math.ceil(viewport.height)}`);
    const canvasFactory = pdfDocument.canvasFactory as PdfCanvasFactory;
    const canvasAndContext = canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));

    try {
      await page.render({
        canvasContext: canvasAndContext.context as never,
        viewport,
      }).promise;
    } catch (error) {
      console.error(`[pdf] render failed on page ${pageNumber}`, error);
      throw error;
    }

    console.log(`[pdf] finished rendering page ${pageNumber}`);

    pages.push({
      pageNumber,
      imageBuffer: canvasAndContext.canvas.toBuffer("image/png"),
      mimeType: "image/png",
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
    });

    canvasFactory.destroy(canvasAndContext);
  }

  console.log(`[pdf] finished render with ${pages.length} page image(s)`);
  return pages;
}

export async function loadImagePage(buffer: Buffer, mimeType: string): Promise<DocumentPageImage> {
  return {
    pageNumber: 1,
    imageBuffer: buffer,
    mimeType,
    width: null,
    height: null,
  };
}

export async function ocrPageImage(page: DocumentPageImage) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }

  const openai = new OpenAI({ apiKey });
  const response = await openai.chat.completions.create({
    model: process.env.OCR_MODEL ?? "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: OCR_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `Process page ${page.pageNumber} of this document.` },
          {
            type: "image_url",
            image_url: {
              url: toDataUrl(page.imageBuffer, page.mimeType),
            },
          },
        ],
      },
    ],
  });

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error("OCR model returned no content.");
  }

  const parsed = JSON.parse(content) as OCRPageResult;
  const lines = Array.isArray(parsed.lines)
    ? parsed.lines.map((line, index) => ({
        line_number: typeof line.line_number === "number" ? line.line_number : index + 1,
        text: typeof line.text === "string" ? line.text : "[unclear]",
        normalized_text:
          typeof line.normalized_text === "string"
            ? line.normalized_text
            : normalizeExtractedText(typeof line.text === "string" ? line.text : "[unclear]"),
        section_title: typeof line.section_title === "string" ? line.section_title : null,
        block_type: isDocumentBlockType(line.block_type) ? line.block_type : "unknown",
        bbox_top: typeof line.bbox_top === "number" ? line.bbox_top : null,
        bbox_left: typeof line.bbox_left === "number" ? line.bbox_left : null,
        bbox_width: typeof line.bbox_width === "number" ? line.bbox_width : null,
        bbox_height: typeof line.bbox_height === "number" ? line.bbox_height : null,
        confidence: typeof line.confidence === "number" ? line.confidence : null,
      }))
    : [];

  return {
    page_number: typeof parsed.page_number === "number" ? parsed.page_number : page.pageNumber,
    lines,
  } satisfies OCRPageResult;
}

function isDocumentBlockType(value: unknown): value is DocumentBlockType {
  return (
    value === "heading" ||
    value === "paragraph" ||
    value === "table_row" ||
    value === "signature" ||
    value === "footer" ||
    value === "header" ||
    value === "unknown"
  );
}

export function createDocumentOutputRows(documentId: string, userId: string, outputPaths: Record<DocumentOutputType, string>): DocumentOutputRecord[] {
  const createdAt = new Date().toISOString();

  return (["txt", "markdown"] as DocumentOutputType[]).map((outputType) => ({
    id: randomUUID(),
    document_id: documentId,
    user_id: userId,
    output_type: outputType,
    storage_path: outputPaths[outputType],
    created_at: createdAt,
  }));
}

export function toDocumentLineRows(
  documentId: string,
  userId: string,
  pages: OCRPageResult[],
): DocumentLineRecord[] {
  const createdAt = new Date().toISOString();
  const rows: DocumentLineRecord[] = [];

  for (const page of pages) {
    for (const line of page.lines) {
      rows.push({
        id: randomUUID(),
        document_id: documentId,
        user_id: userId,
        page_number: page.page_number,
        line_number: line.line_number,
        text: line.text,
        normalized_text: line.normalized_text,
        section_title: line.section_title,
        block_type: line.block_type,
        bbox_top: line.bbox_top,
        bbox_left: line.bbox_left,
        bbox_width: line.bbox_width,
        bbox_height: line.bbox_height,
        confidence: line.confidence,
        created_at: createdAt,
      });
    }
  }

  return rows;
}

export function toDocumentPageRows(
  documentId: string,
  userId: string,
  pages: DocumentPageImage[],
  statuses: Record<number, { storagePath: string | null }>,
): DocumentPageRecord[] {
  const createdAt = new Date().toISOString();

  return pages.map((page) => ({
    id: randomUUID(),
    document_id: documentId,
    user_id: userId,
    page_number: page.pageNumber,
    image_storage_path: statuses[page.pageNumber]?.storagePath ?? null,
    width: page.width,
    height: page.height,
    status: "processed",
    created_at: createdAt,
    updated_at: createdAt,
  }));
}