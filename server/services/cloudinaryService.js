const cloudinary = require('cloudinary').v2;

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;
const avatarFolder = process.env.CLOUDINARY_AVATAR_FOLDER || 'the_game/avatars';

const cloudinaryEnabled = Boolean(cloudName && apiKey && apiSecret);

if (cloudinaryEnabled) {
    cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
    });
}

function ensureCloudinaryConfigured() {
    if (cloudinaryEnabled) return;

    const error = new Error('Cloudinary no está configurado');
    error.code = 'CLOUDINARY_NOT_CONFIGURED';
    throw error;
}

function getAvatarPublicId(userId) {
    return `${avatarFolder}/${userId}`;
}

function uploadAvatarBuffer(userId, buffer) {
    ensureCloudinaryConfigured();

    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                public_id: getAvatarPublicId(userId),
                resource_type: 'image',
                overwrite: true,
                invalidate: true,
            },
            (error, result) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve(result);
            }
        );

        uploadStream.end(buffer);
    });
}

async function deleteAvatar(userId) {
    ensureCloudinaryConfigured();
    return cloudinary.uploader.destroy(getAvatarPublicId(userId), {
        resource_type: 'image',
        invalidate: true,
    });
}

module.exports = {
    uploadAvatarBuffer,
    deleteAvatar,
    ensureCloudinaryConfigured,
    cloudinaryEnabled,
};
