"use client";

import { useActionState, useMemo } from "react";
import { createTranslator, type Language, type MessageKey } from "@/lib/i18n/messages";
import { createHousehold, type CreateHouseholdState } from "./actions";

const INITIAL: CreateHouseholdState = {
  values: { householdName: "", displayName: "" },
  fieldKeys: {},
  errorKey: null,
};

export function WelcomeForm({ language }: { language: Language }) {
  const tr = useMemo(() => createTranslator(language), [language]);
  const [state, action, pending] = useActionState(createHousehold, INITIAL);
  const { fieldKeys, values } = state;
  const failed = state.errorKey !== null;

  const field = (
    name: "householdName" | "displayName",
    label: MessageKey,
    hint: MessageKey,
    autoComplete: string,
  ) => (
    <div className="grid gap-2">
      <label htmlFor={name} className="app-label">
        {tr.t(label)} <span className="app-required">{tr.t("member.required")}</span>
      </label>
      <p id={`${name}-hint`} className="app-hint">
        {tr.t(hint)}
      </p>
      <input
        id={name}
        name={name}
        type="text"
        autoComplete={autoComplete}
        required
        aria-required="true"
        maxLength={80}
        aria-invalid={fieldKeys[name] ? true : undefined}
        aria-describedby={fieldKeys[name] ? `${name}-hint ${name}-error` : `${name}-hint`}
        defaultValue={values[name]}
        key={`${name}-${values[name]}`}
        className="app-input"
      />
      {fieldKeys[name] && (
        <p id={`${name}-error`} className="app-field-error">
          {tr.t(fieldKeys[name])}
        </p>
      )}
    </div>
  );

  return (
    <form action={action} noValidate className="mt-10 grid gap-7">
      {state.errorKey && (
        <div role="alert" className="app-alert">
          <p>{tr.t(state.errorKey)}</p>
        </div>
      )}
      {field("householdName", "welcome.householdName.label", "welcome.householdName.hint", "organization")}
      {field("displayName", "welcome.displayName.label", "welcome.displayName.hint", "name")}
      <div>
        <button type="submit" className="app-button" disabled={pending}>
          {failed ? tr.t("welcome.tryAgain") : tr.t("welcome.submit")}
        </button>
      </div>
    </form>
  );
}
