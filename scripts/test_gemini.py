import google.generativeai as genai
import os
import time
from dotenv import load_dotenv

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel('gemini-2.0-flash-lite-preview-02-05')

print("Testing Gemini 2.0 Flash Exp...")
try:
    response = model.generate_content("Explain the concept of 'Inflation' in one sentence.")
    print(f"Success: {response.text}")
except Exception as e:
    print(f"Error: {e}")
