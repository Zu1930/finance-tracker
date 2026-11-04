/**
 * Основа переводов: плоские ключи вида nav.settings, action.delete, space.family. Пока только русский.
 * Через t() идут подписи и aria-label иконок; остальные тексты интерфейса переносятся по мере правок
 */
export const ru = {
  "app.loading": "Загрузка данных…",
  "app.loadFailed": "Не удалось загрузить данные. Проверьте связь и повторите",
  "app.offline": "Нет связи",

  "nav.sections": "Разделы",
  "nav.feed": "Лента",
  "nav.entry": "Ввод",
  "nav.limits": "Лимиты",
  "nav.money": "Деньги",
  "nav.savings": "Сбережения",
  "nav.chart": "График",
  "nav.help": "Помощь",
  "nav.settings": "Настройки",
  "nav.back": "Назад",
  "nav.voiceSettings": "Голос и Siri",

  "theme.auto": "Тема: как в системе",
  "theme.dark": "Тема: тёмная",
  "theme.light": "Тема: светлая",

  "space.family": "Семья",
  "space.personal": "Личное",
  "space.all": "Всё вместе",
  "space.mine": "Моё",
  "space.choose": "Чей бюджет показать",
  "space.budget": "Бюджет",
  "space.onlyYou": "Это видите только вы",
  "space.onlyYouEntry": "Увидите только вы",
  "space.readOnly": "Только просмотр. Чтобы записать, выберите семью или личное",
  "space.pickToWrite": "Выберите бюджет, чтобы записать",

  "action.close": "Закрыть",
  "action.delete": "Удалить",
  "action.remove": "Убрать",
  "action.more": "Ещё",
  "action.hide": "Скрыть",
  "action.toForm": "В форму",
  "action.export": "Экспорт",
  "action.copy": "Копировать",
  "action.invite": "Пригласить",
  "action.logout": "Выйти",
  "action.reconcile": "Сверка",
  "action.addAccount": "Счёт",
  "action.addGoal": "Создать",
  "action.notifyOn": "Включить",

  "entry.new": "Новая запись",
  "entry.expense": "Расход",
  "entry.income": "Доход",
  "entry.method": "Способ ввода",
  "entry.keys": "Клавиши",
  "entry.voice": "Голос",
  "entry.erase": "Стереть",
  "entry.eraseHold": "Стереть (удерживать — очистить)",
  "entry.date": "Дата",
  "entry.currency": "Валюта",
  "entry.switchSpace": "Переключить бюджет",

  "voice.speak": "Говорить",
  "voice.stop": "Стоп",
  "voice.start": "Начать запись",
  "voice.stopRec": "Остановить запись",
  "voice.help": "Как пользоваться голосовым вводом",
  "voice.removeRow": "Убрать трату",

  "recurring.title": "Регулярные",
  "recurring.paid": "оплачено",
  "recurring.overdue": "просрочено",
  "recurring.due": "К оплате",
  "recurring.actions": "Действия",

  "hint.hide": "Скрыть подсказку",
  "setup.hide": "Скрыть карточку «Настройка»",
  "carry.hide": "Скрыть до следующего месяца",
} as const;

export type I18nKey = keyof typeof ru;
export const t = (key: I18nKey): string => ru[key];
