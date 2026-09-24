# SmartMed Commands Cheatsheet

Both the **Frontend** and **Backend** are currently **RUNNING in the background**.

---

## 1. Access the Application
- **Frontend Web UI**: [http://localhost:3000](http://localhost:3000)
- **AI Backend API**: [http://localhost:8100](http://localhost:8100)
- **API Docs (Swagger UI)**: [http://localhost:8100/docs](http://localhost:8100/docs)

---

## 2. Directory Structure Note
- **Backend folder**: `ai/` (contains `server.py`, `mnn/`, `prompts/`)
- **Frontend folder**: project root `/` (contains `src/`, `package.json`, `vite.config.ts`)

---

## 3. How to Run Manually (Future Reference)

> **Note**: If you see `[Errno 98] address already in use`, it means the server is **already running**.

### Terminal 1: Backend (AI Server)
From project root:
```bash
python3 ai/server.py
```
*Or from the `ai` directory:*
```bash
cd ai
python3 server.py
```

### Terminal 2: Frontend (React / Vite)
From project root:
```bash
npm run dev
```

---

## 4. Useful Test Commands

### Health Check
```bash
curl http://localhost:8100/api/ai/health
```

### AI Model Status
```bash
curl http://localhost:8100/api/ai/status
```

### Test AI Chat Inference
```bash
curl -X POST http://localhost:8100/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What should I do if I forget my medicine?"}'
```

---

## 5. Stop / Restart Services (If Needed)

### Check if ports are active
```bash
# Check port 8100 (Backend)
lsof -i :8100

# Check port 3000 (Frontend)
lsof -i :3000
```

### Kill existing processes on ports
```bash
# Stop backend
fuser -k 8100/tcp

# Stop frontend
fuser -k 3000/tcp
```
