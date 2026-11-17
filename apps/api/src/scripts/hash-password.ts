// Prints the scrambled ("hashed") form of a password read from standard input.
// Used by the server setup to store the control panel password safely.
import { hashPassword } from '../auth/passwords.js';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const pw = input.trim();
if (pw.length < 8) { console.error('Password too short'); process.exit(1); }
console.log(await hashPassword(pw));
