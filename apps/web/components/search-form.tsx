import { MAX_QUERY_LENGTH } from "@descontoreal/core";
import type { ReactElement } from "react";

/** A plain GET form to /pesquisa: it works without JavaScript and keeps the pages that hold it static. */
export function SearchForm({
  defaultValue = "",
  large = false,
}: {
  defaultValue?: string;
  large?: boolean;
}): ReactElement {
  return (
    <form action="/pesquisa" method="get" role="search" className="flex w-full max-w-2xl gap-2">
      <label htmlFor={large ? "pesquisa-principal" : "pesquisa"} className="sr-only">
        Pesquisar produtos
      </label>
      <input
        id={large ? "pesquisa-principal" : "pesquisa"}
        type="search"
        name="q"
        defaultValue={defaultValue}
        maxLength={MAX_QUERY_LENGTH}
        placeholder="Pesquisa um produto ou cola o link da loja"
        className={`min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-slate-900 placeholder:text-slate-500 ${large ? "py-3 text-lg" : "py-2"}`}
      />
      <button
        type="submit"
        className={`rounded-lg bg-indigo-700 font-semibold text-white hover:bg-indigo-800 ${large ? "px-5 text-lg" : "px-4"}`}
      >
        Pesquisar
      </button>
    </form>
  );
}
