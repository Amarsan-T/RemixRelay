import claude_reader
from fastapi import FastAPI
app = FastAPI()
from pydantic import BaseModel

class Inquiry(BaseModel):
    chat: str #input to pass to model
    hist: list | None = None #previous conversation history to pass to model
    
@app.post('/startInquiry')
async def startInquiry(inquiry: Inquiry):
   return claude_reader.beginInquiry(inquiry.chat)

@app.post('/aiAssist')
async def AI_assist(inquiry: Inquiry):
   return claude_reader.AI_assist(inquiry.chat, inquiry.hist)

# test: http://127.0.0.1:8000/docs
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)