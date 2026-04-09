const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');
const uploadsRoot = process.env.UPLOADS_DIR
    ? path.resolve(projectRoot, process.env.UPLOADS_DIR)
    : path.join(projectRoot, 'uploads');
const avatarsDir = path.join(uploadsRoot, 'avatars');

fs.mkdirSync(avatarsDir, { recursive: true });

function getAvatarFilename(userId) {
    return `${userId}.webp`;
}

function getAvatarFilePath(userId) {
    return path.join(avatarsDir, getAvatarFilename(userId));
}

function getAvatarPublicUrl(userId) {
    return `/uploads/avatars/${getAvatarFilename(userId)}`;
}

async function uploadAvatarBuffer(userId, buffer) {
    const targetPath = getAvatarFilePath(userId);
    await fs.promises.writeFile(targetPath, buffer);

    return {
        secure_url: getAvatarPublicUrl(userId),
    };
}

async function deleteAvatar(userId) {
    const targetPath = getAvatarFilePath(userId);
    try {
        await fs.promises.unlink(targetPath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
}

module.exports = {
    uploadAvatarBuffer,
    deleteAvatar,
};
