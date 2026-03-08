const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const activeJobs = new Map();

function getDuration(inputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      inputPath,
    ]);
    let output = '';
    proc.stdout.on('data', d => output += d);
    proc.on('close', code => {
      if (code === 0) resolve(parseFloat(output.trim()) || 0);
      else resolve(0);
    });
    proc.on('error', () => resolve(0));
  });
}

function parseProgress(stderr, totalDuration) {
  const timeMatch = stderr.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  if (!timeMatch || !totalDuration) return 0;
  const secs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 +
    parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 100;
  return Math.min(Math.round((secs / totalDuration) * 100), 99);
}

async function stitchPhoto(inputPath, outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y', '-i', inputPath,
      '-vf', 'v360=input=dfisheye:output=e:ih_fov=204:iv_fov=204',
      '-q:v', '2',
      outputPath,
    ]);
    let stderr = '';
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`ffmpeg photo stitch failed (code ${code}): ${stderr.slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

async function stitchVideo(inputPath, outputPath, jobKey) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const totalDuration = await getDuration(inputPath);

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y', '-i', inputPath,
      '-vf', 'v360=input=dfisheye:output=e:ih_fov=204:iv_fov=204',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '22',
      '-c:a', 'aac',
      outputPath,
    ]);

    let stderr = '';
    proc.stderr.on('data', d => {
      stderr += d;
      const job = activeJobs.get(jobKey);
      if (job) {
        job.progress = parseProgress(stderr, totalDuration);
      }
    });

    proc.on('close', code => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`ffmpeg video stitch failed (code ${code}): ${stderr.slice(-500)}`));
    });
    proc.on('error', reject);

    const job = activeJobs.get(jobKey);
    if (job) job.process = proc;
  });
}

async function generateThumbnail(inputPath, outputPath, options = {}) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const filters = [];
  if (options.needsStitching) {
    filters.push('v360=input=dfisheye:output=e:ih_fov=204:iv_fov=204');
  }
  filters.push('scale=400:-1');

  const args = ['-y', '-i', inputPath];
  if (options.isVideo) {
    args.push('-vf', `select=eq(n\\,0),${filters.join(',')}`, '-frames:v', '1');
  } else {
    args.push('-vf', filters.join(','));
  }
  args.push('-q:v', '4', outputPath);

  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`ffmpeg thumbnail failed (code ${code}): ${stderr.slice(-500)}`));
    });
    proc.on('error', reject);
  });
}

module.exports = { activeJobs, stitchPhoto, stitchVideo, generateThumbnail };
