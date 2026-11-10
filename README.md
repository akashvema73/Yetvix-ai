# Yetvix AI

ChatGPT jaisa full AI workspace. Stack: Next.js 14, Supabase (login + database), Claude API.

## Setup (10 minute)
1. **Node.js 18+** install karo.
2. **Supabase project** banao (supabase.com, free):
   - SQL Editor mein `supabase/schema.sql` ka poora code paste karke **Run** karo (naye aur purane dono database par chalega).
   - Project Settings -> API se `Project URL` aur `anon public key` copy karo.
   - Authentication -> Providers mein Email on rakho. Testing ke liye "Confirm email" off kar sakte ho.
3. **Claude API key** console.anthropic.com se lo.
4. `.env.local` kholo aur values bharo (`.env.example` dekho).
5. Terminal:
   ```
   npm install
   npm run dev
   ```
6. http://localhost:3000 kholo, sign up karo aur chat shuru karo.

## Deploy (Vercel)
GitHub par daalo, Vercel mein import karo, `.env.local` ke saare variables Environment Variables mein add karo. Deploy ke baad Supabase -> Authentication -> URL Configuration mein apna Vercel URL daalo (password reset aur login redirect ke liye).

## Features
- Email login/signup + forgot password
- 4 modes: Coding, Study, Writing, General
- Live streaming jawab, markdown, code blocks (copy button)
- **+ menu**: Photos & files upload (image, PDF, code/text), Web search, Deep research, Thinking, Create image
- Image upload paste (Ctrl+V) aur drag & drop
- **Create image**: Claude SVG image/logo banata hai, preview + SVG download (Claude pixel-photo generate nahi karta)
- **Share**: public read-only link (`/share/<id>`), kabhi bhi band kar sakte ho
- Voice input (mic), Read aloud, Copy, Regenerate, Stop generating
- Chats: search, rename, pin, delete, export (.md)
- Custom instructions (Settings), Dark/Light theme
- Daily message limit (`DAILY_MESSAGE_LIMIT`), Row Level Security, mobile responsive

## Notes
- Web search / Deep research Anthropic ki web search tool use karte hain. Agar error aaye toh console.anthropic.com -> Settings mein web search enable karo.
- Thinking agar model support na kare toh app apne aap bina thinking ke chalta hai.
- Brand/personality badalne ke liye `lib/prompts.js`, colors ke liye `app/globals.css` (top ke variables).
