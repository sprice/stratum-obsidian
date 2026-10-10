import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  editorInfoField,
  editorLivePreviewField,
  setLivePreviewEffect,
  TFile,
} from "./obsidian-host";
import { PublicationEditor } from "../../publication-editor";
import {
  publicationAuthors,
  publicationYaml,
} from "../../publication-metadata";
import type StratumPlugin from "../../plugin";
import type {
  Editor,
  EditorTransaction,
  TFile as ObsidianFile,
} from "obsidian";

const path = "Papers/Synthetic paper.md";
const sample = `---
title: Synthetic manuscript
unrelated: retained # Keep this comment
stratum_publish:
  authors:
    - name: Alex Example
      email: alex@example.org
      affiliations:
        - Example University
        - Example Observatory
    - name: Morgan Sample
      email: morgan@example.org
      affiliations:
        - Example University
---

## Abstract
Synthetic abstract.

## Introduction
Synthetic body remains unchanged.
`;
let view: EditorView;
let backgroundView: EditorView | undefined;
let blockedTransactions = 0;
let partialTransaction = false;
let rememberedInput: HTMLInputElement | null = null;
let service: PublicationEditor;
const events: string[] = [];
for (const type of ["focus", "blur", "pointerdown", "mousedown", "click"])
  document.addEventListener(
    type,
    (event) => {
      const label = (event.target as HTMLElement)?.getAttribute?.("aria-label");
      events.push(
        `${type}: ${label ?? (event.target as HTMLElement)?.tagName}`,
      );
    },
    true,
  );
const publish = {
  document: { path },
  notePreferences: { templateId: "package:aastex" },
  selectedTemplate: { renderer: "aastex" },
  selectedFormat: "pdf",
  layout: { titleSource: "properties" },
  emit() {},
};
function editorInfo(current: () => EditorView) {
  const editor = {
    getValue: () => current().state.doc.toString(),
    offsetToPos: (offset: number) => {
      const line = current().state.doc.lineAt(offset);
      return { line: line.number - 1, ch: offset - line.from };
    },
    transaction: (transaction: EditorTransaction) => {
      const doc = current().state.doc;
      current().dispatch({
        changes: transaction.changes?.map((change) => ({
          from: doc.line(change.from.line + 1).from + change.from.ch,
          to: change.to
            ? doc.line(change.to.line + 1).from + change.to.ch
            : doc.line(change.from.line + 1).from + change.from.ch,
          insert: partialTransaction
            ? change.text.replace("Alex Partial Draft", "Partial editor value")
            : change.text,
        })),
        userEvent: "input.publication",
      });
    },
  } as unknown as Editor;
  return { file: new TFile(), editor };
}
function reset(
  source = sample,
  background = false,
  protectFrontmatter = false,
  readOnly = false,
  partial = false,
) {
  partialTransaction = partial;
  blockedTransactions = 0;
  events.length = 0;
  view?.destroy();
  backgroundView?.destroy();
  backgroundView = undefined;
  service?.unload();
  document.querySelector<HTMLElement>("#editor")!.empty();
  publish.layout.titleSource = "properties";
  publish.selectedFormat = "pdf";
  service = new PublicationEditor({ publish } as unknown as StratumPlugin);
  service.load();
  if (background) {
    backgroundView = new EditorView({
      state: EditorState.create({
        doc: sample.replace("Alex Example", "Background author"),
        extensions: [
          editorInfoField.init(() => editorInfo(() => backgroundView!)),
          editorLivePreviewField,
          EditorView.lineWrapping,
          service.extension(),
        ],
      }),
    });
  }
  view = new EditorView({
    parent: document.querySelector<HTMLElement>("#editor")!,
    state: EditorState.create({
      doc: source,
      extensions: [
        editorInfoField.init(() => editorInfo(() => view)),
        editorLivePreviewField,
        EditorView.lineWrapping,
        EditorState.readOnly.of(readOnly),
        protectFrontmatter
          ? EditorState.transactionFilter.of((transaction) => {
              let multiline = false;
              transaction.changes.iterChanges((from, to) => {
                if (
                  from <
                    publicationYaml(transaction.startState.doc.toString())
                      .end &&
                  transaction.startState.doc.lineAt(from).number !==
                    transaction.startState.doc.lineAt(to).number
                )
                  multiline = true;
              });
              if (multiline) {
                blockedTransactions++;
                return [];
              }
              return transaction;
            })
          : [],
        service.extension(),
      ],
    }),
  });
}
function text() {
  return view.state.doc.toString();
}
function edit(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  )!;
  input.focus();
  input.value = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
}
function key(
  label: string,
  value: string,
  shiftKey = false,
  isComposing = false,
) {
  document
    .querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
    .dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        key: value,
        shiftKey,
        isComposing,
      }),
    );
}
function replace(source: string) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: source },
  });
}
const fixture = {
  events,
  reset,
  text,
  edit,
  key,
  replace,
  sample,
  flush: () => service.flush(path),
  authors: () => publicationAuthors(publicationYaml(text()).properties).authors,
  pending: () => service.pending(path),
  open: () => service.open(new TFile() as unknown as ObsidianFile),
  backgroundText: () => backgroundView?.state.doc.toString(),
  blockedTransactions: () => blockedTransactions,
  rememberInput: (label: string) => {
    rememberedInput = document.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    );
  },
  blurRememberedInput: () =>
    rememberedInput?.dispatchEvent(new FocusEvent("blur")),
  livePreview: (value: boolean) =>
    view.dispatch({ effects: setLivePreviewEffect.of(value) }),
  titleSource: (value: "body" | "properties") => {
    publish.layout.titleSource = value;
    service.refresh();
  },
  output: (value: "pdf" | "docx") => {
    publish.selectedFormat = value;
    service.refresh();
  },
  unload: () => {
    service.unload();
    view.destroy();
  },
};
Object.assign(window, { publicationEditorFixture: fixture });
reset();
document.body.dataset.ready = "true";
