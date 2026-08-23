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

Built-in email, password, and avatar fields, plus `name` (text) and `role` (select: `admin`, `rentor`). New registrations use `rentor` by default.

### `rental`

`address` (text), `rent` (number), `photos` (file, multiple), and `renter` (relation to `users`).

### `bill`

`rental` (relation to `rental`), `rent` (number), `sdge` (number), `att` (number), `total` (number), `dueDate` (date), `paid` (boolean), `paidDate` (date), and `notes` (text).

The app calculates `total` from `rent + sdge + att` whenever a bill is saved.

## Commands

- `npm run dev` starts the development server.
- `npm run check` runs Svelte and TypeScript checks.
- `npm run build` creates a production build.
