FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --onnxruntime-node-install-cuda=skip && npm cache clean --force
# Bake the model into the image so a cold start never downloads it.
RUN node -e "import('@huggingface/transformers').then(async (m) => { m.env.cacheDir = '/app/models'; const id = 'Xenova/siglip-base-patch16-224'; await m.AutoProcessor.from_pretrained(id); await m.SiglipVisionModel.from_pretrained(id, { dtype: 'fp32' }); console.log('model cached'); })"
COPY server.mjs ./
EXPOSE 8080
CMD ["node", "server.mjs"]
