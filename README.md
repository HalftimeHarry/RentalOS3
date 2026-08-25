# RentalOS3

RentalOS3 is a small rental property manager for one rental, its renter, and monthly bills. It uses SvelteKit and TypeScript for the UI and PocketBase for authentication and data storage.

## Run locally

1. Install dependencies: `npm install`
2. Download PocketBase from [pocketbase.io](https://pocketbase.io/docs/) and start it with `./pocketbase serve`.
3. Copy `.env.example` to `.env` and set `PUBLIC_POCKETBASE_URL` if PocketBase is not running at `http://127.0.0.1:8090`.
4. Create the collections below in the PocketBase admin UI, then create an admin and renter user.
5. Start SvelteKit: `npm run dev`

## PocketBase collections

### `users` (Auth collection)

Built-in email, password, and avatar fields, plus `name` (text) and `role` (select: `admin`, `renter`). New registrations use `renter` by default.

### `rental`

`address` (text), `rent` (number), `photos` (file, multiple), and `renter` (relation to `users`).

Do not add a reverse `bills` field to this collection. The canonical relationship is one-way from `bill.rental` to `rental`.

### `bill`

`rental` (relation to `rental`), `rent` (number), `sdge` (number), `att` (number), `total` (number), `dueDate` (date), `paid` (boolean), `paidDate` (date), and `notes` (text).

The app calculates `total` from `rent + sdge + att` whenever a bill is saved.

## Exact PocketBase collection rules

Apply these rules in the PocketBase admin UI for the `rental` and `bill` collections:

```json
{
  "rental": {
    "listRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\"",
    "createRule": "@request.auth.role = \"admin\"",
    "updateRule": "@request.auth.role = \"admin\"",
    "deleteRule": "@request.auth.role = \"admin\""
  },
  "bill": {
    "listRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\"",
    "createRule": "@request.auth.role = \"admin\"",
    "updateRule": "@request.auth.role = \"admin\"",
    "deleteRule": "@request.auth.role = \"admin\""
  }
}
```

For a more permissive setup, you can allow authenticated users to create their own bills while still requiring admin access to edit/delete, but the app expects the admin pattern above for data integrity.

## Correct relationship data shape

Use this shape in PocketBase:

```ts
// rental document
{
  "id": "rental_id",
  "address": "123 Main St",
  "rent": 1800,
  "renter": "user_id"
}

// bill document
{
  "id": "bill_id",
  "rental": "rental_id",
  "rent": 1800,
  "sdge": 120,
  "att": 80,
  "total": 2000,
  "dueDate": "2026-08-25",
  "status": "open",
  "paid": false,
  "notes": "August rent"
}
```

The app should query bills with a filter such as `rental = "rental_id"` and never attempt to write a reverse `bills` array onto the `rental` record.

## Commands

- `npm run dev` starts the development server.
- `npm run check` runs Svelte and TypeScript checks.
- `npm run build` creates a production build.
