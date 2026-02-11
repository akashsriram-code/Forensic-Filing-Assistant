import schedule
import time
import subprocess
import datetime
import os
import sys

# Path to the analysis script
SCRIPT_PATH = os.path.join(os.path.dirname(__file__), "analyze_trends.py")

def job():
    print(f"\n[Scheduler] Starting job at {datetime.datetime.now()}")
    try:
        # Run the script using the same python executable
        result = subprocess.run([sys.executable, SCRIPT_PATH], capture_output=True, text=True)
        print(result.stdout)
        if result.stderr:
            print(f"[Error] {result.stderr}")
    except Exception as e:
        print(f"[Scheduler] Failed to run job: {e}")

# Schedule 3 times a day
schedule.every().day.at("07:00").do(job)
schedule.every().day.at("13:00").do(job)
schedule.every().day.at("20:00").do(job)

print("--- AI Theme Discovery Scheduler Started ---")
print("Running jobs at 07:00, 13:00, 20:00.")
print("Press Ctrl+C to stop.")

# Run once immediately on startup for verification
job()

while True:
    schedule.run_pending()
    time.sleep(60)
