// Automatically use relative path on Vercel or localhost port 8000 during local dev
const API_BASE_URL = process.env.NODE_ENV === 'development' 
    ? 'http://127.0.0.1:8000' 
    : '';

/*
Use for the first message (claude will recommend piano roll or step sequencer to use)
params: 
inquiry (str) - the chat inquiry from user, to be sent to claude
returns:
response from claude in the form of a json {"role": str, "content": str}
*/
async function firstInquiry(inquiry) {
    // information to be sent to Python API: chat is the input to claude, prev is the previous conversation history
    const payload = {
        chat: inquiry,
        hist: null // or previous context string if applicable
    };

    try {
        //send a post request to startInquiry from python API with payload in body
        const response = await fetch('${API_BASE_URL}/startInquiry', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        //error if no response
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        //if success then return response
        const data = await response.json();
        console.log("Success:", data);
        return data
        
        // Catch error
    } catch (error) {
        console.error("Error sending inquiry:", error);
    }
}

/*
params: 
inquiry (str) - the chat inquiry from user, to be sent to claude
Use for the AI Assist to inquire about precise steps
returns:
response from claude in the form of a json {"role": str, "content": str}
*/
async function aiAssist(inquiry) {
    // information to be sent to Python API: chat is the input to claude, prev is the previous conversation history
    const payload = {
        chat: inquiry,
        hist: null // or previous context string if applicable
    };

    try {
        //send a post request to startInquiry from python API with payload in body
        const response = await fetch('${API_BASE_URL}/aiAssist', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        
        //error if no response
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        //if success then return response
        const data = await response.json();
        console.log("Success:", data);
        return data
        
        // Catch error
    } catch (error) {
        console.error("Error sending inquiry:", error);
    }
}

//import these from backend.js to use
export {firstInquiry, aiAssist};