/**
 * שמות תצוגה לשני מדדי חוב שבועיים.
 * אינו משנה חוב רשמי, FIFO או יתרת זכות.
 */

export const WEEK_ORDER_DEBT_LABEL = "חוב הזמנות לפני זכות";

export const WEEK_FIFO_COLLECTIBLE_LABEL = "יתרה לגבייה לאחר FIFO";

export const WEEK_ORDER_DEBT_DETAIL =
  "סכום יתרת כל הזמנה אחרי התשלומים שנרשמו עליה. יתרת זכות של הלקוח אינה מקוזזת כאן.";

export const WEEK_FIFO_COLLECTIBLE_DETAIL =
  "היתרה שעוד אפשר לגבות אחרי שיתרות זכות ומשיכות חוב חולקו FIFO, מההזמנה הישנה לחדשה. זה אינו חוב ההזמנות שלפני הקיזוז.";

export const WEEK_DEBT_METRICS_NOTE = `${WEEK_ORDER_DEBT_DETAIL} ${WEEK_FIFO_COLLECTIBLE_DETAIL}`;
