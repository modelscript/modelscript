import bcrypt from "bcryptjs";
import path from "path";
import { LibraryDatabase } from "../src/database.js";

const dbDir = path.join(process.cwd(), "data");
const db = new LibraryDatabase(dbDir);
const user = db.getUserByEmail("dev@modelscript.org");
console.log("User:", user);
if (user) {
  console.log("Hash matches 'password':", bcrypt.compareSync("password", user.password_hash));
}
