#!/bin/bash

# Define the session name
SESSION="ear2finger-dev"

# Kill the existing session if it is running
tmux kill-session -t $SESSION 2>/dev/null

# Start a new tmux session (detached)
tmux new-session -d -s $SESSION -n "status"

# Window 1: Backend FastAPI Server
tmux new-window -t $SESSION:1 -n "backend"
tmux send-keys -t $SESSION:1 "cd /Users/mac/downloads/English && source .venv/bin/activate && cd backend && uvicorn main:app --reload --host 127.0.0.1 --port 8000" C-m

# Window 2: Frontend Vite Server
tmux new-window -t $SESSION:2 -n "frontend"
tmux send-keys -t $SESSION:2 "cd /Users/mac/downloads/English/frontend && npm run dev" C-m

# Go back to the status window
tmux select-window -t $SESSION:0
tmux send-keys -t $SESSION:0 "echo '=== Ear2Finger Dev Tmux Session ==='" C-m
tmux send-keys -t $SESSION:0 "echo 'FastAPI Backend runs in window 1: \"backend\" (Port 8000)'" C-m
tmux send-keys -t $SESSION:0 "echo 'Vite Frontend runs in window 2: \"frontend\" (Port 3000)'" C-m
tmux send-keys -t $SESSION:0 "echo '===================================='" C-m
tmux send-keys -t $SESSION:0 "git status" C-m

echo "Created tmux session: $SESSION"
echo "To attach, run: tmux attach -t $SESSION"
