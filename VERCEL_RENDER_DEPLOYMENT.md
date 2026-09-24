# SmartMed Deployment Guide: Vercel (Frontend) & Render (Backend)

Deploying the **React Frontend on Vercel** and the **FastAPI AI Backend on Render** gives you:
- **Free Automatic HTTPS & SSL** (enabling microphone access for voice call simulation on any device).
- **Global High-Speed CDN** for the frontend via Vercel.
- **Automated CI/CD** (updates automatically whenever you git push to GitHub).

---

## Step 1: Fix Git Configuration & Push to GitHub

The 403 error happened because your local git remote was set to another user's repository (`GOPIKRISHNA104-gk`), but you are logged in as **`Gopi45-gk`**.

Run these commands in your project root to fix your git identity and point to your repository:

```bash
cd /home/gopikrishna/Documents/smart_med

# 1. Set your Git identity
git config user.name "Gopi45-gk"
git config user.email "your-email@example.com"   # Replace with your GitHub email

# 2. Point remote origin to your GitHub repository
git remote set-url origin https://github.com/Gopi45-gk/smartmed.git

# 3. Add all files and commit
git add .
git commit -m "feat: setup Vercel, Render, Docker and AWS deployment configurations"

# 4. Push to your GitHub repository
git push -u origin main
```

*(If prompted for credentials, use your GitHub username `Gopi45-gk` and a **GitHub Personal Access Token** with `repo` permissions).*

---

## Step 2: Deploy Backend to Render

1. Log into **[Render](https://dashboard.render.com/)** (sign in with your GitHub account).
2. Click **New +** → Select **Web Service**.
3. Under **Connect a Git repository**, choose your repository **`Gopi45-gk/smartmed`**.
4. Configure the service:
   - **Name**: `smartmed-backend`
   - **Region**: Choose the closest region (e.g., `Oregon (US West)` or `Singapore`)
   - **Branch**: `main`
   - **Root Directory**: `ai`
   - **Runtime**: Select **Docker** (Render will automatically detect `ai/Dockerfile`).
   - **Instance Type**: 
     - Choose **Starter** ($7/mo with 512MB–1GB RAM) or **Standard** (2GB RAM) for smooth deep learning model loading.
5. In **Environment Variables**, add:
   - `MNN_DEVICE` = `cpu`
   - `MNN_THREAD_NUM` = `2`
   - `HF_TOKEN` = `your_huggingface_token_here` (optional HuggingFace token for cloud OCR/VLM)
6. Click **Create Web Service**.
7. Once deployment finishes (usually 3–5 minutes), copy your Render backend URL:
   - Example: `https://smartmed-backend.onrender.com`

> [!TIP]
> Test your Render backend: visit `https://<YOUR-RENDER-APP>.onrender.com/api/ai/health`. It should return `{"status":"ok","service":"smartmed-ai","offline":true}`.

---

## Step 3: Deploy Frontend to Vercel

### Option A: Using Vercel Web Dashboard (Easiest)
1. Go to **[Vercel Dashboard](https://vercel.com/dashboard)** (sign in with GitHub).
2. Click **Add New...** → **Project**.
3. Import your GitHub repository: **`Gopi45-gk/smartmed`**.
4. Under **Project Settings**:
   - **Framework Preset**: `Vite` (automatically detected)
   - **Root Directory**: `./` (leave default)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Expand **Environment Variables** and add:
   - **Key**: `VITE_API_BASE_URL`
   - **Value**: `https://<YOUR-RENDER-APP>.onrender.com` (from Step 2)
6. Click **Deploy**.

---

### Option B: Using Vercel CLI Directly from Terminal
You already have the Vercel CLI installed! You can deploy directly:

```bash
cd /home/gopikrishna/Documents/smart_med

# Deploy to Vercel
npx vercel --prod
```
During the prompt:
1. Set up and deploy: **`Y`**
2. Which scope: select your personal account
3. Link to existing project: **`N`**
4. Project name: **`smartmed`**
5. Directory located: **`./`**
6. Want to modify settings: **`N`**

After it finishes, add the environment variable for your Render backend:
```bash
npx vercel env add VITE_API_BASE_URL production
# Paste your Render backend URL: https://smartmed-backend.onrender.com
npx vercel --prod
```

---

## Step 4: Verification

1. Open your Vercel URL: `https://smartmed.vercel.app` (or your assigned Vercel URL).
2. **Microphone & Speech-to-Text**: Click the microphone / Start Call. Because Vercel has built-in SSL (`https://`), browser speech recognition and audio recording will work with full permissions!
3. **Prescription OCR**: Upload a prescription image to test OCR processing.
4. **Multilingual AI Assistant**: Send queries in English, Tamil, Hindi, or Telugu to verify end-to-end communication with your Render backend.
