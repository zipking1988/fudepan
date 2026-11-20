/**
 * Masks sensitive values before text is stored or shown (safety policy items 4 and 5).
 * Detection is best-effort. The original photo is kept unmasked for the audit trail, so the UI also
 * warns users not to photograph cards or documents with ID numbers.
 */
export type SensitiveKind =
  "card_number" | "id_number" | "bank_account" | "insurance_number" | "password" | "one_time_code";

export const MASK = "[MASKED]";

export interface MaskResult {
  text: string;
  kinds: SensitiveKind[];
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

interface LabeledRule {
  kind: SensitiveKind;
  // Group 1 = label (kept), group 2 = secret value (masked).
  pattern: RegExp;
}

const LABELED_RULES: LabeledRule[] = [
  {
    kind: "one_time_code",
    pattern:
      /(one[- ]?time\s*(?:code|password|passcode)|\botp\b|verification\s*code|security\s*code|認証コード|確認コード|ワンタイム(?:パスワード|コード)?)(\s*(?:is|:|：|は|#)?\s*)(\d{4,10})/gi,
  },
  {
    kind: "password",
    pattern:
      /(\bpassword\b|\bpasscode\b|\bpin\b|パスワード|暗証番号)(\s*(?:is|:|：|は|#)?\s*)(\S{3,})/gi,
  },
  {
    kind: "bank_account",
    pattern:
      /(account\s*(?:number|no\.?|#)?|acct\.?|口座番号|口座)(\s*(?:is|:|：|は|#)?\s*)(\d[\d -]{4,}\d)/gi,
  },
  {
    kind: "insurance_number",
    pattern:
      /(insurance\s*(?:number|no\.?|id|#)?|policy\s*(?:number|no\.?|#)|保険証番号|被保険者番号|保険者番号)(\s*(?:is|:|：|は|#)?\s*)([A-Z0-9][A-Z0-9-]{3,})/gi,
  },
];

const DIGIT_RUN = /(?<![\d])(?:\d[ -]?){11,18}\d(?![\d])/g;

export function maskSensitive(input: string): MaskResult {
  // NFKC turns full-width digits and colons into ASCII so detection works on Japanese input.
  let text = input.normalize("NFKC");
  const kinds = new Set<SensitiveKind>();

  for (const rule of LABELED_RULES) {
    text = text.replace(rule.pattern, (_match, label: string, sep: string) => {
      kinds.add(rule.kind);
      return `${label}${sep}${MASK}`;
    });
  }

  text = text.replace(DIGIT_RUN, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
      kinds.add("card_number");
      return MASK;
    }
    if (digits.length === 12) {
      kinds.add("id_number");
      return MASK;
    }
    return match;
  });

  return { text, kinds: [...kinds] };
}
