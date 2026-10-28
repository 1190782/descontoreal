import type { LabelTone } from "@descontoreal/core";
import type { ReactElement } from "react";

const TONE_CLASSES: Readonly<Record<LabelTone, string>> = {
  positive: "bg-green-50 text-green-800 ring-green-700/25",
  caution: "bg-amber-50 text-amber-900 ring-amber-700/25",
  neutral: "bg-slate-100 text-slate-700 ring-slate-600/20",
};

/** A label's name in its colour family; the name is always there, so colour is never the only signal. */
export function LabelBadge({ tone, name }: { tone: LabelTone; name: string }): ReactElement {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium ring-1 ring-inset ${TONE_CLASSES[tone]}`}
    >
      {name}
    </span>
  );
}
