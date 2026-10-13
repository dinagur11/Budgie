import { app } from "./app.js";
import { config } from "./config.js";

const port = Number(config.port) || 3000;

app.listen(port, () => {
  console.log(`Budgie API listening on port ${port}`);
});