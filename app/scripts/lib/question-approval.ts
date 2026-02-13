export type QuestionApprovalOption = {
  label: string;
  description?: string;
};

export type QuestionApprovalItem = {
  header: string;
  question: string;
  options: QuestionApprovalOption[];
  multiple: boolean;
  custom: boolean;
};

function defaultQuestionAnswer(question: QuestionApprovalItem): string[] {
  return [question.options[0]?.label ?? "default answer"];
}

export function parseQuestionApprovalInput(input: unknown): QuestionApprovalItem[] | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const rawQuestions = (input as { questions?: unknown }).questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return null;
  }

  const questions: QuestionApprovalItem[] = [];
  for (const rawQuestion of rawQuestions) {
    if (typeof rawQuestion !== "object" || rawQuestion === null) {
      continue;
    }

    const question = rawQuestion as {
      header?: unknown;
      question?: unknown;
      options?: unknown;
      multiple?: unknown;
      custom?: unknown;
    };

    if (typeof question.header !== "string" || typeof question.question !== "string") {
      continue;
    }

    const options: QuestionApprovalOption[] = [];
    if (Array.isArray(question.options)) {
      for (const rawOption of question.options) {
        if (typeof rawOption !== "object" || rawOption === null) {
          continue;
        }

        const option = rawOption as { label?: unknown; description?: unknown };
        if (typeof option.label !== "string" || option.label.length === 0) {
          continue;
        }

        options.push({
          label: option.label,
          description: typeof option.description === "string" ? option.description : undefined,
        });
      }
    }

    questions.push({
      header: question.header,
      question: question.question,
      options,
      multiple: question.multiple === true,
      custom: question.custom !== false,
    });
  }

  return questions.length > 0 ? questions : null;
}

export function resolveQuestionSelection(
  question: QuestionApprovalItem,
  rawSelection: string,
): string[] {
  const trimmed = rawSelection.trim();
  if (!trimmed) {
    return defaultQuestionAnswer(question);
  }

  const tokens = question.multiple ? trimmed.split(",") : [trimmed];
  const answers: string[] = [];
  for (const token of tokens) {
    const value = token.trim();
    if (!value) {
      continue;
    }

    const index = Number(value);
    if (Number.isInteger(index) && index >= 1 && index <= question.options.length) {
      answers.push(question.options[index - 1]!.label);
      continue;
    }

    const optionMatch = question.options.find((option) => option.label === value);
    if (optionMatch) {
      answers.push(optionMatch.label);
      continue;
    }

    if (question.custom) {
      answers.push(value);
    }
  }

  const deduped = Array.from(new Set(answers));
  if (deduped.length > 0) {
    return deduped;
  }

  return defaultQuestionAnswer(question);
}

export function collectScriptedQuestionAnswers(
  questions: QuestionApprovalItem[],
  scriptedAnswers: string[],
): string[][] {
  return questions.map((question, index) =>
    resolveQuestionSelection(question, scriptedAnswers[index] ?? ""),
  );
}
