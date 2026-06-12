#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Kill anything already on these ports (stale processes)
for PORT in 8000 5173; do
  PIDS=$(lsof -ti :$PORT 2>/dev/null || true)
  if [ -n "$PIDS" ]; then
    echo "Stopping existing process on :$PORT…"
    echo "$PIDS" | xargs kill 2>/dev/null || true
    sleep 0.5
  fi
done

# Start backend
echo "Starting backend…"
cd "$ROOT/backend"
uvicorn main:app --reload &
BACKEND_PID=$!

# Start frontend
echo "Starting frontend…"
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  Backend : http://localhost:8000"
echo "  Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
