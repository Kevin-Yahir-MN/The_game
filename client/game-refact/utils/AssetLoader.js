export class AssetLoader {
    constructor() {
        this.cache = new Map();
    }

    load(url) {
        if (this.cache.has(url)) {
            return Promise.resolve(this.cache.get(url));
        }

        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.cache.set(url, img);
                resolve(img);
            };
            img.onerror = (err) => {
                console.error('Error loading asset', { url, error: err });
                reject(err);
            };
            img.src = url;
        });
    }
}