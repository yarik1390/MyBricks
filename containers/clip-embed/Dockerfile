FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir onnxruntime==1.22.0 pillow==11.2.1 numpy==2.2.6

COPY server.py /app/server.py
ENV CLIP_ONNX_PATH=/models/mobileclip-s2.onnx
ENV PORT=8080
EXPOSE 8080

CMD ["python", "/app/server.py"]
