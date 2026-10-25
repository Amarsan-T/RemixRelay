import claude_reader
from fastapi import FastAPI
app = FastAPI()
from pydantic import BaseModel

class Inquiry(BaseModel):
    chat: str
    prev: str | None = None
    
@app.post('/startInquiry')
def startInquiry(inquiry: Inquiry):
   return claude_reader.beginInquiry(inquiry.chat)

# test: http://127.0.0.1:8000/docs
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)