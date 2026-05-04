import { randomUUID } from "crypto";
import { loadImage } from "@napi-rs/canvas";
import { OpenAI } from "openai";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import type { DocumentBlockType, DocumentLineRecord, DocumentOutputRecord, DocumentOutputType, DocumentPageRecord, DocumentWordRecord } from "@/lib/types";

export interface OCRWord {
  word_index: number;
  text: string;
  normalized_text: string;
  bbox_top: number | null;
  bbox_left: number | null;
  bbox_width: number | null;
  bbox_height: number | null;
  confidence: number | null;
}

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
  words: OCRWord[];
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

const PDFJS_ASSET_BASE_PATH = `${process.cwd()}/node_modules/pdfjs-dist/`;
const PDFJS_CMAP_URL = `${PDFJS_ASSET_BASE_PATH}cmaps/`;
const PDFJS_STANDARD_FONT_DATA_URL = `${PDFJS_ASSET_BASE_PATH}standard_fonts/`;

const OCR_SYSTEM_PROMPT = `You are an OCR and document layout extraction engine.

Extract the visible text from this scanned page in natural reading order (top-to-bottom and left-to-right when relevant).
Keep dates, dollar amounts, names, addresses, and legal wording exact.
Do not hallucinate missing text.
If text is unreadable, return "[unclear]".
Return only valid JSON. Do not include markdown or commentary.

For each line, extract every individual word with its tight bounding box.
Bounding boxes must be relative coordinates from 0 to 1.

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
"confidence": number or null,
"words": [
{
"word_index": number,
"text": string,
"normalized_text": string,
"bbox_top": number or null,
"bbox_left": number or null,
"bbox_width": number or null,
"bbox_height": number or null,
"confidence": number or null
}
]
}
]
}

Important:
Bounding boxes must tightly wrap only the visible text, not blank space.
The line bounding box should tightly wrap only the visible text in that line.
The word bounding box should tightly wrap only that word.
Do not use table cell boxes as text boxes.
Do not use section boxes as text boxes.
Do not include blank space in the bounding box.
Do not include the full row width unless the text actually fills the full row.
Preserve table rows as single logical rows when possible.
Do not summarize.
Extract only what is visible on the page.
Output must be valid structured JSON only.`;

function normalizeRelativeValue(value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }

  if (value >= 0 && value <= 1) {
    return Number(value.toFixed(6));
  }

  // Accept percentage-like values as a fallback.
  if (value > 1 && value <= 100) {
    return Number((value / 100).toFixed(6));
  }

  return null;
}

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
  const image = await loadImage(buffer);

  return {
    pageNumber: 1,
    imageBuffer: buffer,
    mimeType,
    width: image.width,
    height: image.height,
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
    ? parsed.lines.map((line, index) => {
        const text = typeof line.text === "string" ? line.text : "[unclear]";
        const words = Array.isArray(line.words)
          ? line.words.map((word, wordIndex) => ({
              word_index: typeof word.word_index === "number" ? word.word_index : wordIndex + 1,
              text: typeof word.text === "string" ? word.text : "[unclear]",
              normalized_text:
                typeof word.normalized_text === "string"
                  ? word.normalized_text
                  : normalizeExtractedText(typeof word.text === "string" ? word.text : "[unclear]"),
              bbox_top: normalizeRelativeValue(word.bbox_top),
              bbox_left: normalizeRelativeValue(word.bbox_left),
              bbox_width: normalizeRelativeValue(word.bbox_width),
              bbox_height: normalizeRelativeValue(word.bbox_height),
              confidence: typeof word.confidence === "number" ? word.confidence : null,
            }))
          : [];

        return {
          line_number: typeof line.line_number === "number" ? line.line_number : index + 1,
          text,
          normalized_text:
            typeof line.normalized_text === "string"
              ? line.normalized_text
              : normalizeExtractedText(text),
          section_title: typeof line.section_title === "string" ? line.section_title : null,
          block_type: isDocumentBlockType(line.block_type) ? line.block_type : "unknown",
          bbox_top: normalizeRelativeValue(line.bbox_top),
          bbox_left: normalizeRelativeValue(line.bbox_left),
          bbox_width: normalizeRelativeValue(line.bbox_width),
          bbox_height: normalizeRelativeValue(line.bbox_height),
          confidence: typeof line.confidence === "number" ? line.confidence : null,
          words,
        };
      })
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

export function toDocumentWordRows(
  documentId: string,
  userId: string,
  lineIdsByPageAndLine: Record<string, string>,
  pages: OCRPageResult[],
): DocumentWordRecord[] {
  const createdAt = new Date().toISOString();
  const rows: DocumentWordRecord[] = [];

  for (const page of pages) {
    for (const line of page.lines) {
      const lineKey = `${page.page_number}:${line.line_number}`;
      const lineId = lineIdsByPageAndLine[lineKey];

      if (!lineId) {
        continue;
      }

      for (const word of line.words ?? []) {
        rows.push({
          id: randomUUID(),
          document_id: documentId,
          document_line_id: lineId,
          user_id: userId,
          page_number: page.page_number,
          line_number: line.line_number,
          word_index: word.word_index,
          text: word.text,
          normalized_text: word.normalized_text,
          bbox_top: word.bbox_top,
          bbox_left: word.bbox_left,
          bbox_width: word.bbox_width,
          bbox_height: word.bbox_height,
          confidence: word.confidence,
          created_at: createdAt,
        });
      }
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
