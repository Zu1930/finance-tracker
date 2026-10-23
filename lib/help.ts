/** Статьи помощи: id → файл content/help/<id>.md. У solo статья family называется «Пригласить партнёра» */
export const ARTICLES = [
  { id: "start", title: "С чего начать" },
  { id: "entry", title: "Ввод трат" },
  { id: "limits", title: "Лимиты" },
  { id: "family", title: "Семья", soloTitle: "Пригласить партнёра" },
  { id: "plan", title: "План месяца" },
  { id: "recurring", title: "Обязательные платежи" },
  { id: "savings", title: "Счета и сверка" },
  { id: "currency", title: "Валюты" },
  { id: "voice", title: "Голос и Siri" },
  { id: "install", title: "Приложение на телефоне" },
  { id: "faq", title: "Вопросы и ответы" },
] as const;
export type ArticleId = (typeof ARTICLES)[number]["id"];
export const isArticle = (v: unknown): v is ArticleId => ARTICLES.some((a) => a.id === v);
export const articleTitle = (id: ArticleId, solo: boolean) => {
  const a = ARTICLES.find((x) => x.id === id)!;
  return solo && "soloTitle" in a ? a.soloTitle : a.title;
};
