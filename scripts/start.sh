#!/bin/bash

# Script to start and monitor the MEV bot
# This will automatically restart the bot if it crashes

LOG_DIR="./logs"
CRASH_LOG="$LOG_DIR/crash_log.txt"
MAX_RESTARTS=10
RESTART_DELAY=30 # seconds

# Create log directory if it doesn't exist
mkdir -p $LOG_DIR

echo "Starting MEV bot monitor script at $(date)"
echo "Logs will be saved to $LOG_DIR"

# Track number of restarts
restart_count=0

# Function to start the bot
start_bot() {
  local timestamp=$(date +"%Y%m%d_%H%M%S")
  local log_file="$LOG_DIR/mevbot_$timestamp.log"
  
  echo "Starting MEV bot (attempt $((restart_count + 1))) at $(date)"
  echo "Output will be logged to $log_file"
  
  # Start the bot in the background and redirect output to log file
  npm run start:ws > "$log_file" 2>&1
  
  # Capture exit code
  local exit_code=$?
  
  # Log crash information
  echo "------------------------------------------------" >> "$CRASH_LOG"
  echo "MEV bot crashed at $(date) with exit code $exit_code" >> "$CRASH_LOG"
  echo "Check $log_file for details" >> "$CRASH_LOG"
  
  return $exit_code
}

# Main loop
while [ $restart_count -lt $MAX_RESTARTS ]; do
  # Start the bot
  start_bot
  
  # Increment restart counter
  restart_count=$((restart_count + 1))
  
  # Check if max restarts reached
  if [ $restart_count -ge $MAX_RESTARTS ]; then
    echo "Reached maximum number of restart attempts ($MAX_RESTARTS). Giving up."
    echo "Reached maximum number of restart attempts ($MAX_RESTARTS) at $(date). Giving up." >> "$CRASH_LOG"
    break
  fi
  
  # Wait before restarting
  echo "Bot crashed. Waiting $RESTART_DELAY seconds before restarting (attempt $restart_count of $MAX_RESTARTS)..."
  sleep $RESTART_DELAY
done

echo "Monitor script exited at $(date)" 