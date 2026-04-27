export interface CreateComparisonState {
  error: string | null;
}

export interface ProcessComparisonState {
  error: string | null;
}

export interface RunComparisonState {
  error: string | null;
}

export const initialCreateComparisonState: CreateComparisonState = {
  error: null,
};

export const initialProcessComparisonState: ProcessComparisonState = {
  error: null,
};

export const initialRunComparisonState: RunComparisonState = {
  error: null,
};