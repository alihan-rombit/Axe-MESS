const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    maxHttpBufferSize: 1e8
});

const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, 'public', 'uploads');
try {
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
} catch (err) {
    console.log('Папка уже существует или создана:', err.message);
}
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Хранилища данных
const usersByUsername = new Map();
const globalMessages = [];
const privateMessages = [];
const onlineUsers = new Map();
const userSockets = new Map();
const mutesMap = new Map();
const bansMap = new Map();
const userLastMsgTime = new Map();

function getRandomGradient() {
    const gradients = [
        'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
        'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
        'linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)',
        'linear-gradient(135deg, #10b981 0%, #059669 100%)'
    ];
    return gradients[Math.floor(Math.random() * gradients.length)];
}

// ИИ Ассистент
(async () => {
    const aiPassword = await bcrypt.hash('ai_pass_456', 10);
    usersByUsername.set('ai_assistant', {
        displayName: 'Axe AI Assistant',
        username: 'ai_assistant',
        phone: '+00000000000',
        passwordHash: aiPassword,
        avatarUrl: null,
        avatarColor: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        bio: 'Умный ИИ ассистент приложения Axe.',
        isAdmin: false
    });
})();

// API Регистрации
app.post('/api/register', async (req, res) => {
    try {
        const { displayName, username, password, phone } = req.body;
        if (!displayName || !username || !password) {
            return res.status(400).json({ error: 'Заполните обязательные поля' });
        }

        if (phone && !/^\+[0-9]+$/.test(phone)) {
            return res.status(400).json({ error: 'Номер телефона должен начинаться с + и содержать только цифры' });
        }

        const cleanUsername = username.trim().toLowerCase();
        if (usersByUsername.has(cleanUsername)) {
            return res.status(400).json({ error: 'Этот юзернейм уже занят' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const userObj = {
            displayName: displayName.trim(),
            username: cleanUsername,
            phone: phone ? phone.trim() : '',
            passwordHash,
            avatarUrl: null,
            avatarColor: getRandomGradient(),
            bio: 'Всем привет!',
            isAdmin: cleanUsername === 'alihan_rombit'
        };

        usersByUsername.set(cleanUsername, userObj);
        return res.json({ success: true });
    } catch (e) {
        return res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// API Входа
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const cleanUsername = (username || '').trim().toLowerCase();
        const user = usersByUsername.get(cleanUsername);

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(400).json({ error: 'Неверные данные для входа' });
        }

        const banExpire = bansMap.get(cleanUsername);
        if (banExpire && (banExpire === Infinity || Date.now() < banExpire)) {
            return res.status(403).json({ error: `Ваш аккаунт забанен.` });
        }

        return res.json({
            success: true,
            user: {
                displayName: user.displayName,
                username: user.username,
                phone: user.phone,
                avatarUrl: user.avatarUrl,
                avatarColor: user.avatarColor,
                bio: user.bio,
                isAdmin: user.isAdmin
            }
        });
    } catch (e) {
        return res.status(500).json({ error: 'Ошибка при входе' });
    }
});

// API Поиска пользователей
app.get('/api/users/search', (req, res) => {
    const query = (req.query.q || '').trim().toLowerCase();
    if (!query) return res.json({ users: [] });

    const results = [];
    for (const [uname, u] of usersByUsername.entries()) {
        if (uname.includes(query) || u.displayName.toLowerCase().includes(query)) {
            results.push({
                displayName: u.displayName,
                username: u.username,
                avatarUrl: u.avatarUrl,
                avatarColor: u.avatarColor
            });
        }
    }
    res.json({ users: results });
});

// API Загрузки медиа/аватарки
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    res.json({ url: '/uploads/' + req.file.filename, originalName: req.file.originalname, mimetype: req.file.mimetype });
});

// API Настроек (Обновление профиля и аватарки)
app.post('/api/user/update', async (req, res) => {
    const { currentUsername, newDisplayName, newUsername, newPhone, newBio, newAvatarUrl } = req.body;
    const user = usersByUsername.get(currentUsername);

    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    if (newPhone && !/^\+[0-9]+$/.test(newPhone)) {
        return res.status(400).json({ error: 'Неверный формат телефона' });
    }

    let activeUsername = currentUsername;

    if (newUsername && newUsername.toLowerCase() !== currentUsername) {
        const cleanNew = newUsername.toLowerCase();
        if (usersByUsername.has(cleanNew)) {
            return res.status(400).json({ error: 'Юзернейм уже занят' });
        }
        usersByUsername.delete(currentUsername);
        user.username = cleanNew;
        usersByUsername.set(cleanNew, user);
        activeUsername = cleanNew;
    }

    if (newDisplayName) user.displayName = newDisplayName;
    if (newPhone !== undefined) user.phone = newPhone;
    if (newBio !== undefined) user.bio = newBio;
    if (newAvatarUrl !== undefined) user.avatarUrl = newAvatarUrl;

    const updatedData = {
        displayName: user.displayName,
        username: user.username,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        avatarColor: user.avatarColor,
        bio: user.bio,
        isAdmin: user.isAdmin
    };

    io.emit('user_profile_updated', { oldUsername: currentUsername, user: updatedData });
    res.json({ success: true, user: updatedData });
});

function generateAIResponse(text, senderName) {
    const query = text.toLowerCase().trim();
    if (query.includes('привет') || query.includes('здравствуй')) return `Здравствуйте, ${senderName}! Чем могу помочь?`;
    if (query.includes('как дела')) return `Все системы функционируют идеально!`;
    return `Ваше сообщение получено, ${senderName}. Я всегда на связи!`;
}

// Socket.IO
io.on('connection', (socket) => {
    
    socket.on('user_connected', (username) => {
        if (!username) return;
        const clean = username.toLowerCase();
        onlineUsers.set(socket.id, clean);
        userSockets.set(clean, socket.id);
        io.emit('user_status_change', { username: clean, online: true });
    });

    socket.on('get_user_info', (targetUsername) => {
        const user = usersByUsername.get(targetUsername.toLowerCase());
        if (user) {
            socket.emit('user_info_response', {
                displayName: user.displayName,
                username: user.username,
                phone: user.phone,
                avatarUrl: user.avatarUrl,
                avatarColor: user.avatarColor,
                bio: user.bio,
                online: Array.from(onlineUsers.values()).includes(user.username)
            });
        }
    });

    socket.on('get_chat_history', ({ chatType, target }) => {
        const sender = onlineUsers.get(socket.id);
        if (!sender) return;

        if (chatType === 'global') {
            socket.emit('chat_history', globalMessages);
        } else {
            const history = privateMessages.filter(m => 
                (m.sender === sender && m.receiver === target.toLowerCase()) ||
                (m.sender === target.toLowerCase() && m.receiver === sender)
            );
            socket.emit('chat_history', history);
        }
    });

    socket.on('send_message', (data) => {
        const sender = onlineUsers.get(socket.id);
        if (!sender) return;

        const lastMsgTime = userLastMsgTime.get(sender) || 0;
        if (Date.now() - lastMsgTime < 500) {
            return socket.emit('error_message', 'Антиспам: Слишком частая отправка!');
        }
        userLastMsgTime.set(sender, Date.now());

        const muteExpire = mutesMap.get(sender);
        if (muteExpire && Date.now() < muteExpire) {
            const mins = Math.ceil((muteExpire - Date.now()) / 60000);
            return socket.emit('error_message', `Вы замучены. Осталось: ${mins} мин.`);
        }

        const textContent = (data.content || '').trim();
        const senderObj = usersByUsername.get(sender);

        // Команды суперправ
        if (textContent.startsWith('/')) {
            if (!senderObj || !senderObj.isAdmin) {
                return socket.emit('error_message', 'Команды доступны только администраторам!');
            }

            const parts = textContent.split(' ');
            const cmd = parts[0].toLowerCase();
            const targetUser = parts[1] ? parts[1].replace('@', '').toLowerCase() : null;

            if (!targetUser || (!usersByUsername.has(targetUser) && cmd !== '/анбан')) {
                return socket.emit('error_message', 'Укажите верный юзернейм!');
            }

            if (cmd === '/мут') {
                const durationMins = parseInt(parts[2]) || 5;
                mutesMap.set(targetUser, Date.now() + durationMins * 60000);
                io.emit('system_notification', `👑 @${sender} выдал мут @${targetUser} на ${durationMins} мин.`);
                return;
            } 
            else if (cmd === '/анмут') {
                mutesMap.delete(targetUser);
                io.emit('system_notification', `👑 @${sender} снял мут с @${targetUser}.`);
                return;
            }
            else if (cmd === '/бан') {
                const durationMins = parseInt(parts[2]) || 60;
                bansMap.set(targetUser, Date.now() + durationMins * 60000);
                const targetSocketId = userSockets.get(targetUser);
                if (targetSocketId) io.to(targetSocketId).emit('kicked', 'Вы забанены администратором.');
                io.emit('system_notification', `👑 @${sender} забанил @${targetUser} на ${durationMins} мин.`);
                return;
            }
            else if (cmd === '/анбан') {
                bansMap.delete(targetUser);
                io.emit('system_notification', `👑 @${sender} разбанил @${targetUser}.`);
                return;
            }
        }

        const msgObj = {
            id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            sender,
            receiver: data.chatType === 'private' ? data.target.toLowerCase() : 'global',
            senderName: senderObj ? senderObj.displayName : sender,
            avatarUrl: senderObj ? senderObj.avatarUrl : null,
            avatarColor: senderObj ? senderObj.avatarColor : getRandomGradient(),
            type: data.type || 'text',
            content: textContent,
            fileUrl: data.fileUrl || null,
            fileName: data.fileName || null,
            replyTo: data.replyTo || null,
            timestamp: new Date().toISOString()
        };

        if (data.chatType === 'global') {
            globalMessages.push(msgObj);
            if (globalMessages.length > 500) globalMessages.shift();
            io.emit('receive_message', msgObj);
        } else {
            privateMessages.push(msgObj);
            const targetUser = data.target.toLowerCase();

            if (targetUser === 'ai_assistant') {
                socket.emit('receive_message', msgObj);
                setTimeout(() => {
                    const aiReply = {
                        id: 'msg-' + Date.now() + '-ai',
                        sender: 'ai_assistant',
                        receiver: sender,
                        senderName: 'Axe AI Assistant',
                        avatarUrl: null,
                        avatarColor: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        type: 'text',
                        content: generateAIResponse(textContent, senderObj ? senderObj.displayName : sender),
                        replyTo: null,
                        timestamp: new Date().toISOString()
                    };
                    privateMessages.push(aiReply);
                    socket.emit('receive_message', aiReply);
                }, 500);
                return;
            }

            const targetSocketId = userSockets.get(targetUser);
            if (targetSocketId) {
                io.to(targetSocketId).emit('receive_message', msgObj);
            }
            socket.emit('receive_message', msgObj);
        }
    });

    socket.on('delete_message', ({ msgId, forAll, chatType, targetUser }) => {
        if (forAll) {
            if (chatType === 'global') {
                const idx = globalMessages.findIndex(m => m.id === msgId);
                if (idx !== -1) globalMessages.splice(idx, 1);
                io.emit('message_deleted', { msgId });
            } else {
                const idx = privateMessages.findIndex(m => m.id === msgId);
                if (idx !== -1) privateMessages.splice(idx, 1);
                socket.emit('message_deleted', { msgId });
                if (targetUser) {
                    const targetSocketId = userSockets.get(targetUser.toLowerCase());
                    if (targetSocketId) io.to(targetSocketId).emit('message_deleted', { msgId });
                }
            }
        } else {
            socket.emit('message_deleted', { msgId });
        }
    });

    // WebRTC
    socket.on('call_user', ({ userToCall, signalData, from, isVideo }) => {
        const targetSocketId = userSockets.get(userToCall.toLowerCase());
        if (targetSocketId) {
            io.to(targetSocketId).emit('incoming_call', { signal: signalData, from, isVideo });
        }
    });

    socket.on('answer_call', (data) => {
        const targetSocketId = userSockets.get(data.to.toLowerCase());
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_accepted', data.signal);
        }
    });

    socket.on('end_call', ({ to }) => {
        const targetSocketId = userSockets.get(to.toLowerCase());
        if (targetSocketId) {
            io.to(targetSocketId).emit('call_ended');
        }
    });

    socket.on('disconnect', () => {
        const username = onlineUsers.get(socket.id);
        if (username) {
            onlineUsers.delete(socket.id);
            userSockets.delete(username);
            io.emit('user_status_change', { username, online: false });
        }
    });
});

server.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
