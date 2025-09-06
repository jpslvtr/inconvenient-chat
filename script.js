let currentRoom = null;
let unsubscribeMessages = null;
let userId = null;
let myParticipantName = null;
let myPrivateKey = null;
let myPassphrase = '';
let decryptedPrivateKey = null;
let isSetupComplete = false;
let currentRoomData = null; // Store current room data

function generateUserId() {
    return 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function waitForFirestore() {
    return new Promise((resolve) => {
        const checkFirestore = () => {
            if (window.firestoreLoaded && window.db) {
                resolve();
            } else {
                setTimeout(checkFirestore, 100);
            }
        };
        checkFirestore();
    });
}

function generateRoomCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function saveIdentityToStorage() {
    if (!myParticipantName || !myPrivateKey || !currentRoom) return;

    const identityData = {
        name: myParticipantName,
        privateKey: myPrivateKey,
        passphrase: myPassphrase
    };

    localStorage.setItem(`identity_${currentRoom}`, JSON.stringify(identityData));
}

async function loadIdentityFromStorage() {
    if (!currentRoom) return false;

    const stored = localStorage.getItem(`identity_${currentRoom}`);
    if (!stored) return false;

    try {
        const identityData = JSON.parse(stored);

        // Validate that we have all required data
        if (!identityData.name || !identityData.privateKey) {
            localStorage.removeItem(`identity_${currentRoom}`);
            return false;
        }

        // Check if this person still exists as a participant in the room
        const roomDoc = await getDoc(doc(db, 'rooms', currentRoom));
        const roomData = roomDoc.data();
        const participants = roomData.participants || {};

        if (!participants[identityData.name]) {
            // Person no longer exists in room, clear storage
            localStorage.removeItem(`identity_${currentRoom}`);
            return false;
        }

        // Restore identity
        myParticipantName = identityData.name;
        myPrivateKey = identityData.privateKey;
        myPassphrase = identityData.passphrase || '';

        // Test that private key still works
        const parsedPrivateKey = await openpgp.readPrivateKey({ armoredKey: myPrivateKey });
        if (parsedPrivateKey.isDecrypted()) {
            decryptedPrivateKey = parsedPrivateKey;
        } else {
            decryptedPrivateKey = await openpgp.decryptKey({
                privateKey: parsedPrivateKey,
                passphrase: myPassphrase
            });
        }

        isSetupComplete = true;

        // Update UI
        document.getElementById('setupForm').classList.add('hidden');
        document.getElementById('setupComplete').classList.remove('hidden');
        document.getElementById('displayName').textContent = myParticipantName;
        document.getElementById('newMessage').disabled = false;
        document.getElementById('sendButton').disabled = false;

        // Clear the setup status message
        document.getElementById('setupStatus').innerHTML = '';

        // Force refresh messages and participants display if we have room data
        if (currentRoomData) {
            displayMessages(currentRoomData.messages || []);
            displayParticipants(currentRoomData.participants || {});
            updateMessageCount(currentRoomData.messages || []);
        }

        return true;
    } catch (error) {
        console.error('Failed to load identity:', error);
        localStorage.removeItem(`identity_${currentRoom}`);
        return false;
    }
}

function updateMessageCount(messages) {
    if (isSetupComplete && myParticipantName) {
        // Count unique messages by grouping by timestamp and sender
        const uniqueMessages = new Map();
        messages.filter(msg => msg.recipient === myParticipantName).forEach(msg => {
            const key = `${msg.timestamp}_${msg.sender}`;
            uniqueMessages.set(key, msg);
        });
        document.getElementById('messageStatus').textContent = `(${uniqueMessages.size} messages)`;
    } else {
        // Fallback to total count if not set up
        document.getElementById('messageStatus').textContent = `(${messages.length} total messages)`;
    }
}

async function createRoom() {
    await waitForFirestore();
    const roomCode = generateRoomCode();
    userId = generateUserId();

    try {
        await setDoc(doc(db, 'rooms', roomCode), {
            created: Date.now(),
            messageCount: 0,
            messages: [],
            participants: {}
        });

        enterRoom(roomCode);
        document.getElementById('roomStatus').innerHTML = '<div class="success">Room created successfully!</div>';

    } catch (error) {
        document.getElementById('roomStatus').innerHTML = `<div class="error">Failed to create room: ${error.message}</div>`;
    }
}

async function joinRoom() {
    await waitForFirestore();
    const roomCode = document.getElementById('joinRoomCode').value.trim();

    if (!roomCode || roomCode.length !== 6) {
        document.getElementById('roomStatus').innerHTML = '<div class="error">Please enter a valid 6-digit room code</div>';
        return;
    }

    try {
        const roomDoc = await getDoc(doc(db, 'rooms', roomCode));
        if (!roomDoc.exists()) {
            document.getElementById('roomStatus').innerHTML = '<div class="error">Room not found. Make sure the code is correct.</div>';
            return;
        }

        userId = generateUserId();
        enterRoom(roomCode);
        document.getElementById('roomStatus').innerHTML = '<div class="success">Joined room successfully!</div>';

    } catch (error) {
        document.getElementById('roomStatus').innerHTML = `<div class="error">Failed to join room: ${error.message}</div>`;
    }
}

async function enterRoom(roomCode) {
    currentRoom = roomCode;
    document.getElementById('roomSelection').classList.add('hidden');
    document.getElementById('chatInterface').classList.remove('hidden');
    document.getElementById('currentRoomCode').textContent = roomCode;

    startMessageListener();

    // Try to load saved identity
    await loadIdentityFromStorage();
}

async function leaveRoom() {
    if (unsubscribeMessages) {
        unsubscribeMessages();
        unsubscribeMessages = null;
    }

    // Clear saved identity
    if (currentRoom) {
        localStorage.removeItem(`identity_${currentRoom}`);
    }

    // Clear all state
    currentRoom = null;
    currentRoomData = null;
    userId = null;
    myParticipantName = null;
    myPrivateKey = null;
    myPassphrase = '';
    decryptedPrivateKey = null;
    isSetupComplete = false;

    // Reset UI to default state
    document.getElementById('setupForm').classList.remove('hidden');
    document.getElementById('setupComplete').classList.add('hidden');
    document.getElementById('newMessage').disabled = true;
    document.getElementById('sendButton').disabled = true;

    // Clear form fields
    document.getElementById('myName').value = '';
    document.getElementById('myPublicKey').value = '';
    document.getElementById('myPrivateKey').value = '';
    document.getElementById('myPassphrase').value = '';
    document.getElementById('newMessage').value = '';
    document.getElementById('setupStatus').innerHTML = '';

    document.getElementById('roomSelection').classList.remove('hidden');
    document.getElementById('chatInterface').classList.add('hidden');
    document.getElementById('joinRoomCode').value = '';
    document.getElementById('roomStatus').innerHTML = '';
}

async function setupIdentity() {
    const name = document.getElementById('myName').value.trim();
    const publicKey = document.getElementById('myPublicKey').value.trim();
    const privateKey = document.getElementById('myPrivateKey').value.trim();
    const passphrase = document.getElementById('myPassphrase').value;

    if (!name || !publicKey || !privateKey) {
        document.getElementById('setupStatus').innerHTML = '<div class="error">Please fill in name, public key, and private key</div>';
        return;
    }

    if (!publicKey.includes('BEGIN PGP PUBLIC KEY') || !privateKey.includes('BEGIN PGP PRIVATE KEY')) {
        document.getElementById('setupStatus').innerHTML = '<div class="error">Invalid key format - please check your keys</div>';
        return;
    }

    try {
        // Read the private key first
        const parsedPrivateKey = await openpgp.readPrivateKey({ armoredKey: privateKey });

        // Check if the key is already decrypted (no passphrase protection)
        if (parsedPrivateKey.isDecrypted()) {
            decryptedPrivateKey = parsedPrivateKey;
        } else {
            // Only decrypt if it's encrypted (has passphrase protection)
            decryptedPrivateKey = await openpgp.decryptKey({
                privateKey: parsedPrivateKey,
                passphrase: passphrase
            });
        }

        // Check if name already exists in the room
        const roomDoc = await getDoc(doc(db, 'rooms', currentRoom));
        const roomData = roomDoc.data();
        const participants = roomData.participants || {};

        if (participants[name]) {
            document.getElementById('setupStatus').innerHTML = '<div class="error">Name already exists in this room - choose a different name</div>';
            return;
        }

        // Save keys and participant info
        myPrivateKey = privateKey;
        myPassphrase = passphrase;
        myParticipantName = name;
        isSetupComplete = true;

        // Add to room participants
        await updateDoc(doc(db, 'rooms', currentRoom), {
            [`participants.${name}`]: publicKey
        });

        // Save identity to localStorage
        saveIdentityToStorage();

        // Update UI
        document.getElementById('setupForm').classList.add('hidden');
        document.getElementById('setupComplete').classList.remove('hidden');
        document.getElementById('displayName').textContent = name;
        document.getElementById('newMessage').disabled = false;
        document.getElementById('sendButton').disabled = false;

        document.getElementById('setupStatus').innerHTML = '<div class="success">Setup complete! You can now send messages.</div>';

    } catch (error) {
        console.error('Setup error:', error);
        document.getElementById('setupStatus').innerHTML = `<div class="error">Setup failed: ${error.message}. Check your private key and passphrase.</div>`;
    }
}

function editIdentity() {
    document.getElementById('setupForm').classList.remove('hidden');
    document.getElementById('setupComplete').classList.add('hidden');
    document.getElementById('newMessage').disabled = true;
    document.getElementById('sendButton').disabled = true;
    isSetupComplete = false;
}

async function addParticipant() {
    await waitForFirestore();
    const name = document.getElementById('participantName').value.trim();
    const key = document.getElementById('newParticipantKey').value.trim();

    if (!name || !key) {
        document.getElementById('participantsStatus').innerHTML = '<div class="error">Please enter both name and public key</div>';
        return;
    }

    if (!key.includes('BEGIN PGP PUBLIC KEY')) {
        document.getElementById('participantsStatus').innerHTML = '<div class="error">Invalid PGP public key format</div>';
        return;
    }

    try {
        const roomDoc = await getDoc(doc(db, 'rooms', currentRoom));
        const roomData = roomDoc.data();
        const participants = roomData.participants || {};

        if (participants[name]) {
            document.getElementById('participantsStatus').innerHTML = '<div class="error">Participant already exists in this room</div>';
            return;
        }

        await updateDoc(doc(db, 'rooms', currentRoom), {
            [`participants.${name}`]: key
        });

        document.getElementById('participantName').value = '';
        document.getElementById('newParticipantKey').value = '';
        document.getElementById('participantsStatus').innerHTML = `<div class="success">"${name}" added to room!</div>`;

    } catch (error) {
        document.getElementById('participantsStatus').innerHTML = `<div class="error">Failed to add participant: ${error.message}</div>`;
    }
}

async function sendMessage() {
    if (!isSetupComplete) {
        alert('Please complete setup first');
        return;
    }

    const messageText = document.getElementById('newMessage').value.trim();
    if (!messageText) {
        alert('Please enter a message');
        return;
    }

    try {
        const roomDoc = await getDoc(doc(db, 'rooms', currentRoom));
        const roomData = roomDoc.data();
        const participants = roomData.participants || {};

        if (Object.keys(participants).length === 0) {
            alert('No participants in this room yet');
            return;
        }

        const encryptedMessages = [];
        for (const [participantName, participantKey] of Object.entries(participants)) {
            try {
                const publicKey = await openpgp.readKey({ armoredKey: participantKey });
                const encrypted = await openpgp.encrypt({
                    message: await openpgp.createMessage({ text: messageText }),
                    encryptionKeys: publicKey
                });

                encryptedMessages.push({
                    id: Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                    timestamp: Date.now(),
                    encrypted: encrypted,
                    sender: myParticipantName,
                    recipient: participantName
                });
            } catch (error) {
                console.error(`Failed to encrypt for ${participantName}:`, error);
            }
        }

        if (encryptedMessages.length === 0) {
            alert('Failed to encrypt message for any participants');
            return;
        }

        await updateDoc(doc(db, 'rooms', currentRoom), {
            messages: arrayUnion(...encryptedMessages),
            messageCount: increment(encryptedMessages.length),
            lastActivity: Date.now()
        });

        document.getElementById('newMessage').value = '';

    } catch (error) {
        alert(`Failed to send message: ${error.message}`);
    }
}

// Add Enter key support for sending messages
document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('newMessage').addEventListener('keypress', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!document.getElementById('sendButton').disabled) {
                sendMessage();
            }
        }
    });
});

function startMessageListener() {
    const roomRef = doc(db, 'rooms', currentRoom);

    unsubscribeMessages = onSnapshot(roomRef, (doc) => {
        if (doc.exists()) {
            const data = doc.data();
            currentRoomData = data; // Store the room data
            displayMessages(data.messages || []);
            displayParticipants(data.participants || {});
            updateMessageCount(data.messages || []);
        } else {
            document.getElementById('messageStatus').textContent = '(Room not found)';
        }
    }, (error) => {
        document.getElementById('messageStatus').textContent = '(Connection error)';
        console.error('Message listener error:', error);
    });
}

function displayParticipants(participants) {
    const listDiv = document.getElementById('participantsList');

    if (!participants || Object.keys(participants).length === 0) {
        listDiv.innerHTML = '<div style="color: #666; font-style: italic;">No participants yet</div>';
        return;
    }

    listDiv.innerHTML = '';
    Object.keys(participants).forEach(name => {
        const participantDiv = document.createElement('div');
        participantDiv.style.cssText = 'border-bottom: 1px solid #eee; padding: 8px; margin-bottom: 5px;';
        const isYou = name === myParticipantName ? ' (you)' : '';
        participantDiv.innerHTML = `
                    <strong>${name}${isYou}</strong>
                    <div style="font-size: 10px; color: #666; margin-top: 2px;">
                        ${isYou ? 'Your identity' : 'Room participant'}
                    </div>
                `;
        listDiv.appendChild(participantDiv);
    });
}

async function decryptMessageContent(encryptedText) {
    if (!decryptedPrivateKey) return null;

    try {
        const encryptedMessage = await openpgp.readMessage({ armoredMessage: encryptedText });
        const { data: decrypted } = await openpgp.decrypt({
            message: encryptedMessage,
            decryptionKeys: decryptedPrivateKey
        });
        return decrypted;
    } catch (error) {
        return null;
    }
}

async function displayMessages(messages) {
    const messagesDiv = document.getElementById('messages');

    if (!isSetupComplete) {
        messagesDiv.innerHTML = '<div style="color: #808080; font-style: italic; text-align: center; margin-top: 50px;">Complete setup below to start chatting</div>';
        return;
    }

    if (messages.length === 0) {
        messagesDiv.innerHTML = '<div style="color: #808080; font-style: italic; text-align: center; margin-top: 50px;">No messages yet. Start the conversation!</div>';
        return;
    }

    // Filter messages for current user and group by timestamp+sender to get unique messages
    const myMessages = messages.filter(msg => msg.recipient === myParticipantName);
    const uniqueMessages = new Map();

    myMessages.forEach(msg => {
        const key = `${msg.timestamp}_${msg.sender}`;
        uniqueMessages.set(key, msg);
    });

    const sortedMessages = Array.from(uniqueMessages.values()).sort((a, b) => a.timestamp - b.timestamp);

    messagesDiv.innerHTML = '';

    for (const msg of sortedMessages) {
        const messageDiv = document.createElement('div');
        const isOwnMessage = msg.sender === myParticipantName;
        messageDiv.className = `message-item ${isOwnMessage ? 'own' : 'other'}`;

        const time = new Date(msg.timestamp).toLocaleTimeString();
        const decryptedContent = await decryptMessageContent(msg.encrypted);

        messageDiv.innerHTML = `
                   <div class="message-time">${time}</div>
                   <div class="message-sender">${isOwnMessage ? 'You' : msg.sender}</div>
                   <div class="message-content">
                       ${decryptedContent || '<em>Failed to decrypt</em>'}
                   </div>
               `;

        messagesDiv.appendChild(messageDiv);
    }

    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}