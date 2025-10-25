# Chat App (Ready)

This is a ready-to-deploy simple chat application using Node.js + Express + Socket.io + MongoDB.
Features:
- Register / Login with email + password (JWT)
- Real-time private messages via Socket.io
- Store messages in MongoDB
- Upload images and videos (stored to /uploads and served statically)
- Single-file frontend at /public/index.html

## Quick start (local)
1. Install:
   ```bash
   npm install
   ```
2. Create uploads folder:
   ```bash
   mkdir uploads
   ```
3. Set environment variables (create a `.env` file):
   ```
   MONGODB_URI=mongodb://localhost:27017/chat_app
   JWT_SECRET=your_secret_here
   PORT=3000
   ```
   Or use MongoDB Atlas and set MONGODB_URI accordingly.

4. Start:
   ```bash
   npm start
   ```
5. Open `http://localhost:3000` in your browser.

## Deploying to free hosts
- **Replit**: Create a new Node.js Repl, upload the project files, set the env variables in Secrets, and Run.
- **Render**: Push to GitHub and create a Web Service pointing to this repo (build command `npm install` and start `npm start`).
- **Railway / Fly.io**: similar steps, ensure you set MONGODB_URI and JWT_SECRET as environment variables.

## Notes & Security
- This project is a starter/demo. For production:
  - Use HTTPS.
  - Use a cloud storage (S3 / Cloudinary) for media.
  - Add input validation, rate limiting, and proper CORS config.
  - Use strong JWT_SECRET and rotate keys.