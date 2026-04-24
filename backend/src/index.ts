// 1. Load .env before anything else reads process.env.
import "dotenv/config";

// 2. Validate config immediately — exits with a clear error if required vars
//    are missing. Must happen before app.ts imports any service module.
import { validateConfig, config } from "./config";
validateConfig();

// 3. Now safe to boot the Express app.
import app from "./app";

app.listen(config.port, () => {
  console.log(`Backend API listening on http://localhost:${config.port}`);
});
