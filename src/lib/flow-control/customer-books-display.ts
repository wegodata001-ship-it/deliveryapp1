/**
 * תצוגת ספרים לסיכום שבוע.
 * אינו משנה את חוב הלקוח, FIFO או יתרת הזכות בכרטסת.
 * booksNetUsd הוא הפרש בין שני הסיכומים. הוא אינו סכום לגבייה
 * ואינו קיזוז של זכות לקוח אחד מול חוב של לקוח אחר.
 */

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export type CustomerBooksDisplay = {
  openDebtUsd: number;
  creditUsd: number;
  booksNetUsd: number;
};

export function summarizeCustomerBooks(signedOpenDebtsUsd: number[]): CustomerBooksDisplay {
  let openDebtUsd = 0;
  let creditUsd = 0;
  for (const raw of signedOpenDebtsUsd) {
    const signed = round2(raw);
    if (signed > 0) openDebtUsd = round2(openDebtUsd + signed);
    else if (signed < 0) creditUsd = round2(creditUsd + -signed);
  }
  return {
    openDebtUsd,
    creditUsd,
    booksNetUsd: round2(openDebtUsd - creditUsd),
  };
}
