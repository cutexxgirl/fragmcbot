# Admin API Manual & Specification

Этот документ предназначен для создания Frontend-клиента или админ-панели для управления ботом FragmentBot.

## Базовый URL
`http:// <SERVER_IP> : <PORT>` (по умолчанию порт 3000)

## Аутентификация
Все запросы требуют заголовок:
`Authorization: Bearer <ADMIN_ACCESS_TOKEN>`

Токен администратора — это `accessToken` пользователя Telegram, у которого есть запись в таблице `Admin` с флагом `isActive: true`.

---

## 1. Управление пользователями

### Получить список пользователей
**GET** `/admin/users`

**Параметры (Query):**
- `page` (number): Номер страницы (def: 1)
- `limit` (number): Кол-во на странице (def: 20)
- `search` (string): Поиск по username, Fragment ID или Telegram ID.
- `status` (enum): `active`, `expired`, `inactive`, `shared`.
- `level` (enum): `novice`, `legend`, `spark`.

**Пример ответа:**
```json
{
  "data": [
    {
      "id": 123,
      "telegramId": "123456789",
      "username": "user1",
      "status": "active",
      "subscriptionLevel": "legend",
      "fragmentId": "USER_ONE",
      "expiresAtFragment": "2025-12-31T23:59:59.000Z"
    }
  ],
  "meta": { "total": 100, "totalPages": 5 }
}
```

### Получить детальную инфо о пользователе
**GET** `/admin/users/:id` (id = telegramId)

Возвращает полную информацию, включая:
- Историю тикетов (`supportTickets`)
- Кому подарил доступ (`sharedByMe`)
- Кто подарил ему (`sharedToMe`)

### Изменить пользователя (Patch)
**PATCH** `/admin/users/:id`

**Body (JSON):**
```json
{
  "isFrozen": true,              // Заморозить/Разморозить
  "status": "active",            // Изменить статус вручную
  "subscriptionLevel": "spark",  // Изменить уровень подписки
  "expiresAtFragment": "ISO_DATE", // Изменить дату окончания
  "username": "new_name"
}
```

### Забанить пользователя
**POST** `/admin/users/:id/ban`

**Body:**
```json
{
  "reason": "Спам в поддержке"
}
```

### Разбанить пользователя
**POST** `/admin/users/:id/unban`
(Тело не требуется)

---

## 2. Промокоды (Promo Codes)

### Список всех промокодов
**GET** `/admin/promos`

Показывает все созданные коды и статистику их использования.

**Пример ответа:**
```json
[
  {
    "id": 1,
    "code": "SUMMER2025",
    "grantDays": 7,
    "grantLevel": "legend",
    "maxActivations": 100,
    "_count": {
      "activations": 45 // Количество активаций
    },
    "createdAt": "...",
    "validUntil": "null" // или дата
  }
]
```

### Создать промокод
**POST** `/admin/promos`

**Body:**
```json
{
  "code": "FREE_WEEK",       // Код (минимум 3 символа)
  "grantDays": 7,            // Сколько дней давать
  "grantLevel": "novice",    // Уровень (novice, legend, spark)
  "maxActivations": 50,      // Максимум активаций (def: 1)
  "validMinutes": 60         // (Опционально) Срок жизни кода в минутах. Если не передать — вечный.
}
```

### Удалить промокод
**DELETE** `/admin/promos/:id` (id = внутренний ID промокода, не сам код)

Удаляет промокод и всю историю его активаций.

---

## 3. Статистика (Dashboard)

**GET** `/admin/dashboard`

Возвращает общие цифры для дашборда.

**Пример ответа:**
```json
{
  "totalUsers": 1500,
  "activeUsers": 800,
  "byLevel": {
    "legend": 100,
    "spark": 50
  },
  "frozenUsers": 5,
  "sharedUsers": 20
}
```
