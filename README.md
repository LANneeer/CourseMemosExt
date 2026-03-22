# 🔍 DOM Analyzer — Chrome Extension

Chrome-расширение с авторизацией. Сканирует DOM страницы, отправляет
содержимое на ваш бэкенд для AI-анализа и подсвечивает элементы
по результату (✅ / ❌ / ➖ / ⚠️).

---

## Структура

```
dom-analyzer-extension/
├── manifest.json      Конфигурация Manifest V3
├── content.js         Внедряется в страницу — DOM-сканер + подсветка
├── content.css        Стили обводок и бейджей
├── popup.html         Два экрана: Login → Main
├── popup.js           Авторизация, сессия, управление анализом
├── background.js      Service Worker (контекстное меню)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Как работает авторизация

### Поток (flow)

```
Пользователь               Расширение              Бэкенд
    │                          │                       │
    ├─ вводит email+password ─►│                       │
    │                          ├─ POST /api/auth/login─►│
    │                          │◄─ { access_token,     │
    │                          │    refresh_token,     │
    │                          │    user, expires_at } │
    │                          │                       │
    │                          │  Сохраняет токен      │
    │                          │  в chrome.storage     │
    │                          │                       │
    ├─ нажимает Analyze ──────►│                       │
    │                          ├─ POST /api/analyze    │
    │                          │  Authorization:       │
    │                          │  Bearer <token> ─────►│
    │                          │◄─ { results }         │
    │◄── подсветка элементов ──┤                       │
```

### Что хранит расширение (chrome.storage.local)

```json
{
  "session": {
    "baseUrl": "http://localhost:8000",
    "token": "eyJhbG...",
    "refreshToken": "dGhpcyBpc...",
    "email": "user@example.com",
    "name": "User",
    "expiresAt": 1711234567890
  }
}
```

Токен сохраняется между перезапусками браузера. При каждом открытии
расширение проверяет валидность токена (GET `/api/auth/me`),
при истечении автоматически обновляет (POST `/api/auth/refresh`).

### Эндпоинты, которые должен реализовать бэкенд

| Метод | URL                  | Тело запроса                               | Ответ                                                     |
|-------|----------------------|--------------------------------------------|------------------------------------------------------------|
| POST  | `/api/auth/login`    | `{ email, password }`                      | `{ access_token, refresh_token?, user?, expires_at? }`     |
| POST  | `/api/auth/refresh`  | `{ refresh_token }`                        | `{ access_token, refresh_token?, expires_at? }`            |
| GET   | `/api/auth/me`       | — (Bearer token в header)                  | `{ email, name }` или 401                                 |
| POST  | `/api/auth/logout`   | — (Bearer token в header)                  | 200 OK                                                     |
| POST  | `/api/analyze`       | `{ prompt, elements[], pageUrl, pageTitle }`| `{ results: [{ id, sentiment, confidence }] }`            |

- **login** — обязательный. Должен вернуть как минимум `access_token`.
- **refresh** — опциональный. Если не реализован, пользователь просто перелогинится.
- **me** — опциональный. Используется для проверки токена.
- **logout** — опциональный. Вызывается при Sign Out.
- **analyze** — обязательный. Это основной эндпоинт анализа.

Все запросы к `/api/analyze` содержат заголовок `Authorization: Bearer <token>`.

---

## ⚙️ Локальная установка

### 1. Распаковать архив

Распакуйте `dom-analyzer-extension.zip` в любую папку:
```
C:\Users\me\extensions\dom-analyzer-extension\
```

### 2. Открыть страницу расширений Chrome

В адресной строке:
```
chrome://extensions/
```

### 3. Включить режим разработчика

Переключатель **«Developer mode»** в правом верхнем углу → ON.

### 4. Загрузить расширение

Кнопка **«Load unpacked»** → выберите папку `dom-analyzer-extension/`.

### 5. Закрепить в панели

Нажмите 🧩 (пазл) справа от адресной строки → 📌 рядом с DOM Analyzer.

### 6. Использование

1. Кликните по иконке расширения
2. Введите URL бэкенда, email, пароль → **Sign In**
3. После входа настройте CSS-селекторы
4. Нажмите **⚡ Analyze Page**
5. Элементы подсветятся по результатам

> После изменения кода: `chrome://extensions/` → кнопка 🔄 на карточке расширения.

---

## 🏪 Публикация в Chrome Web Store

### 1. Регистрация разработчика

1. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Войдите с Google-аккаунтом
3. Оплатите **единоразовый сбор $5**
4. Заполните профиль (имя, email, сайт)

### 2. Чеклист перед публикацией

- [ ] `manifest.json` → `version` актуальна
- [ ] `name` и `description` заполнены
- [ ] Иконки: 16×16, 48×48, 128×128
- [ ] Убраны `console.log` отладочные сообщения
- [ ] `host_permissions` сужены до нужных доменов:
      ```json
      "host_permissions": [
        "https://your-backend.com/*"
      ]
      ```
- [ ] Есть Privacy Policy (обязательна при сборе данных)

### 3. Создать ZIP

```bash
cd dom-analyzer-extension
zip -r ../dom-analyzer-v1.1.0.zip . -x ".*" "README.md"
```

### 4. Ресурсы для магазина

| Ресурс              | Размер             | Формат    |
|---------------------|--------------------|-----------|
| Иконка              | 128×128 px         | PNG       |
| Скриншоты (1–5 шт.) | 1280×800 или 640×400 | PNG/JPG |
| Промо-баннер (опц.) | 1400×560 px        | PNG/JPG   |

Совет: сделайте скриншоты экрана логина и страницы с подсветкой.

### 5. Загрузка

1. Dashboard → **«+ New Item»**
2. Загрузите ZIP
3. Заполните:
   - Название, описание, категория (Developer Tools)
   - Загрузите скриншоты и иконку
4. Раздел **Privacy**:
   - Перечислите собираемые данные (email, текст элементов)
   - Ссылка на Privacy Policy
   - Обоснование каждого `permission`
5. **«Submit for review»**

### 6. Ревью

Обычно от нескольких часов до 3 дней. Частые причины отказа:
- `<all_urls>` без обоснования
- Нет Privacy Policy
- Обфусцированный код (запрещён в Manifest V3)

### 7. Обновление

1. Увеличьте `version` в `manifest.json`
2. Новый ZIP
3. Dashboard → Package → **Upload new package** → Submit

---

## Отладка

**Content script:** DevTools на странице (F12) → Console → фильтр `[DOM Analyzer]`

**Popup:** `chrome://extensions/` → «Inspect views: popup.html»

**Background:** `chrome://extensions/` → «Service Worker» → DevTools
