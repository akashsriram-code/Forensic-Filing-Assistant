from huggingface_hub import InferenceClient
import os
from dotenv import load_dotenv

load_dotenv()
token = os.getenv("HUGGINGFACE_API_TOKEN")
print(f"Token present: {bool(token)}")

client = InferenceClient(api_key=token)

print("Testing Hugging Face Inference...")
try:
    response = client.chat_completion(
        messages=[{"role": "user", "content": "Explain market liquidity in one sentence."}],
        model="HuggingFaceH4/zephyr-7b-beta", 
        max_tokens=50
    )
    print(f"Success: {response.choices[0].message.content}")
except Exception as e:
    print(f"Error: {e}")
