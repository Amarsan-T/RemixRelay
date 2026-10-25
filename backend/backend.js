/*
params: 
inquiry - the chat inquiry from user, to be sent to claude
Use for the first message (claude will recommend piano roll or step sequencer to use)
*/
async function startInquiry(inquiry) {
    // information to be sent to Python API
    const payload = {
        chat: inquiry,
        prev: null // or previous context string if applicable
    };

    try {
        const response = await fetch('http://127.0.0.1:8000/startInquiry', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        console.log("Success:", data);
        
        // Do something with the response here
    } catch (error) {
        console.error("Error sending inquiry:", error);
    }
}

// Trigger the function (e.g., on a button click)
sendInquiry();