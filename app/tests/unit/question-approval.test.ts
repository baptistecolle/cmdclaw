import { describe, expect, it } from "vitest";
import {
  collectScriptedQuestionAnswers,
  parseQuestionApprovalInput,
  resolveQuestionSelection,
  type QuestionApprovalItem,
} from "../../scripts/lib/question-approval";

describe("question approval helpers", () => {
  it("parses multiple flag from question payload", () => {
    const parsed = parseQuestionApprovalInput({
      questions: [
        {
          header: "Pick",
          question: "Choose options",
          options: [{ label: "Alpha" }, { label: "Beta" }],
          multiple: true,
          custom: false,
        },
      ],
    });

    expect(parsed).toEqual([
      {
        header: "Pick",
        question: "Choose options",
        options: [
          { label: "Alpha", description: undefined },
          { label: "Beta", description: undefined },
        ],
        multiple: true,
        custom: false,
      },
    ]);
  });

  it("collects multiple scripted answers for multi-select questions", () => {
    const questions: QuestionApprovalItem[] = [
      {
        header: "Pick",
        question: "Choose options",
        options: [{ label: "Alpha" }, { label: "Beta" }, { label: "Gamma" }],
        multiple: true,
        custom: false,
      },
    ];

    const answers = collectScriptedQuestionAnswers(questions, ["1,3"]);

    expect(answers).toEqual([["Alpha", "Gamma"]]);
  });

  it("falls back to default option when multi-select scripted input is invalid", () => {
    const question: QuestionApprovalItem = {
      header: "Pick",
      question: "Choose options",
      options: [{ label: "Alpha" }, { label: "Beta" }],
      multiple: true,
      custom: false,
    };

    expect(resolveQuestionSelection(question, "999,0,not-valid")).toEqual(["Alpha"]);
  });
});
