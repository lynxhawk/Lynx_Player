<template>
  <div class="container">
    <div class="player">
      <canvas id="visualizer"></canvas>
      <div class="control_list">
        <!-- 播放进度条 -->
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          v-model="progress"
          @input="updateProgressDisplay"
          @change="seekTrack"
          class="progress-bar"
        />

        <div class="controls">
          <!-- 上一首按钮 -->
          <button @click="prevTrack">
            <span class="mdi mdi-skip-previous"></span>
          </button>
          <!-- 播放/暂停按钮 -->
          <button @click="togglePlay">
            <span :class="isPlaying ? 'mdi mdi-pause' : 'mdi mdi-play'"></span>
          </button>
          <!-- 下一首按钮 -->
          <button @click="nextTrack">
            <span class="mdi mdi-skip-next"></span>
          </button>
          <!-- 循环模式按钮 -->
          <button @click="toggleLoopMode">
            <span v-if="currentLoopMode === 0" class="mdi mdi-repeat"></span>
            <span
              v-else-if="currentLoopMode === 1"
              class="mdi mdi-repeat-off"
            ></span>
            <span v-else class="mdi mdi-shuffle"></span>
          </button>
          <!-- 选择文件按钮 -->
          <label class="custom-file-upload">
            <input
              type="file"
              accept="audio/*"
              multiple
              @change="handleFileUpload"
            />
            <span class="mdi mdi-folder-music"></span>
          </label>
        </div>

        <div class="playlist">
          <h3>播放列表</h3>
          <ul>
            <li
              v-for="(track, index) in tracks"
              :key="index"
              :class="{ playing: index === currentTrackIndex }"
              @click="playSpecificTrack(index)"
            >
              {{ track.name }}
              <span
                @click.stop="removeTrack(index)"
                class="mdi mdi-delete"
              ></span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
  <!-- 音频播放元素 -->
  <audio
    ref="audioElement"
    @timeupdate="updateProgressDisplay"
    @ended="onTrackEnd"
    @loadedmetadata="initializeDuration"
  ></audio>
  
</template>

<script lang="ts">
import { defineComponent, ref, reactive, onMounted, watch } from "vue";

const DB_NAME = "MusicPlayerDB";
const STORE_NAME = "Tracks";
const DB_VERSION = 1;

let db: IDBDatabase | null = null;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
};

const addTrackToDB = (track: { name: string; file: File }) => {
  if (!db) return;
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  store.add(track);
};

const getTracksFromDB = (): Promise<
  { id: number; name: string; file: File }[]
> => {
  return new Promise((resolve, reject) => {
    if (!db) {
      resolve([]);
      return;
    }

    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result as { id: number; name: string; file: File }[]);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
};

const deleteTrackFromDB = (id: number) => {
  if (!db) return;
  const transaction = db.transaction(STORE_NAME, "readwrite");
  const store = transaction.objectStore(STORE_NAME);
  store.delete(id);
};

export default defineComponent({
  name: "App",
  setup() {
    const audioElement = ref<HTMLAudioElement | null>(null);
    const audioContext = ref<AudioContext | null>(null);
    const analyser = ref<AnalyserNode | null>(null);
    const audioSource = ref<AudioBufferSourceNode | null>(null);
    const isPlaying = ref(false);
    const currentTrackIndex = ref(0);
    const tracks = reactive<{ id: number; name: string; file: File }[]>([]);
    const dataArray = ref<Uint8Array | null>(null);
    const loopModes = ["单曲循环", "顺序循环", "随机播放"];
    const currentLoopMode = ref(0);
    const progress = ref(0); // 进度条的当前值（0-100）
    let trackDuration = 0; // 音频总时长

    const updateProgressDisplay = () => {
      if (audioContext.value && trackDuration > 0) {
        progress.value = (audioContext.value.currentTime / trackDuration) * 100;
      }
    };

    const seekTrack = () => {
      if (!audioContext.value || trackDuration <= 0) return;

      const seekTime = (progress.value / 100) * trackDuration; // 计算目标播放时间

      // 停止当前播放
      if (audioSource.value) {
        audioSource.value.stop();
        audioSource.value.disconnect();
      }

      // 重新创建 audioSource 并从指定时间开始播放
      loadTrack(currentTrackIndex.value).then(() => {
        audioSource.value.start(0, seekTime); // 从 seekTime 开始播放
        isPlaying.value = true;
        startProgressUpdate(); // 重新开始更新进度条
        visualize(); // 重新启动可视化效果
      });
    };

    const startProgressUpdate = () => {
      const update = () => {
        if (audioContext.value && isPlaying.value) {
          const currentTime = audioContext.value.currentTime;
          progress.value = (currentTime / trackDuration) * 100; // 更新进度条
          requestAnimationFrame(update);
        }
      };
      update();
    };

    // 文件上传
    const handleFileUpload = async (event: Event) => {
      const files = (event.target as HTMLInputElement).files;
      if (files) {
        Array.from(files).forEach((file) => {
          const track = { name: file.name, file };
          addTrackToDB(track);
          tracks.push({ id: Date.now(), name: file.name, file });
        });
      }
    };

    // 加载音频
    // 加载音频时设置总时长
    const loadTrack = async (index: number) => {
      if (!audioContext.value) {
        audioContext.value = new (window.AudioContext ||
          window.webkitAudioContext)();
      }

      const track = tracks[index];
      const arrayBuffer = await track.file.arrayBuffer();
      const buffer = await audioContext.value.decodeAudioData(arrayBuffer);

      // 停止旧的音频源
      if (audioSource.value) {
        audioSource.value.stop();
        audioSource.value.disconnect();
      }

      // 创建新的音频源
      audioSource.value = audioContext.value.createBufferSource();
      audioSource.value.buffer = buffer;

      trackDuration = buffer.duration; // 更新歌曲时长
      progress.value = 0; // 重置进度条

      if (!analyser.value) {
        analyser.value = audioContext.value.createAnalyser();
        analyser.value.fftSize = 512;
      }

      audioSource.value.connect(analyser.value);
      analyser.value.connect(audioContext.value.destination);

      updateProgressDisplay(); // 初始化进度条显示
    };

    // 播放指定曲目
    const playSpecificTrack = (index: number) => {
      stopPlayback(); // 确保旧的音频被停止
      currentTrackIndex.value = index; // 更新当前歌曲索引
      progress.value = 0; // 重置进度条
      loadTrack(index).then(() => {
        startPlayback(); // 播放新歌
      });
    };

    // 播放或暂停
    const togglePlay = () => {
      if (!audioSource.value) {
        loadTrack(currentTrackIndex.value).then(() => {
          startPlayback();
        });
      } else if (isPlaying.value) {
        stopPlayback();
      } else {
        startPlayback();
      }
    };

    const startPlayback = () => {
      if (!audioSource.value) return;

      audioSource.value.start(0);
      isPlaying.value = true;
      progress.value = 0; // 确保进度条重置
      startProgressUpdate(); // 开始实时更新进度条
      visualize();

      // 监听播放结束事件
      audioSource.value.onended = () => {
        isPlaying.value = false;
        if (currentLoopMode.value === 0) {
          loadTrack(currentTrackIndex.value).then(() => startPlayback()); // 单曲循环
        } else {
          nextTrack(); // 播放下一首
        }
      };
    };

    const stopPlayback = () => {
      if (audioSource.value) {
        audioSource.value.stop();
        audioSource.value.disconnect();
        audioSource.value = null;
      }
      isPlaying.value = false;
    };

    const toggleLoopMode = () => {
      currentLoopMode.value = (currentLoopMode.value + 1) % loopModes.length;
    };

    const prevTrack = () => {
      if (currentLoopMode.value === 2) {
        const randomIndex = Math.floor(Math.random() * tracks.length);
        currentTrackIndex.value = randomIndex;
      } else {
        currentTrackIndex.value =
          (currentTrackIndex.value - 1 + tracks.length) % tracks.length;
      }
      loadTrack(currentTrackIndex.value).then(() => {
        startPlayback();
      });
    };

    const nextTrack = () => {
      if (currentLoopMode.value === 2) {
        const randomIndex = Math.floor(Math.random() * tracks.length);
        currentTrackIndex.value = randomIndex;
      } else {
        currentTrackIndex.value = (currentTrackIndex.value + 1) % tracks.length;
      }
      progress.value = 0; // 从头开始播放时，重置进度条
      loadTrack(currentTrackIndex.value).then(() => {
        startPlayback();
      });
    };

    // 删除曲目
    const removeTrack = (index: number) => {
      const track = tracks[index];
      deleteTrackFromDB(track.id);
      tracks.splice(index, 1);
    };

    const visualize = () => {
      const canvas = document.getElementById("visualizer") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d");

      if (!ctx || !analyser.value) return;

      canvas.width = 600;
      canvas.height = 600;

      const centerX = canvas.width / 2; // 画布中心 X
      const centerY = canvas.height / 2; // 画布中心 Y
      const radiusX = canvas.width / 3; // X方向半径
      const radiusY = canvas.height / 3; // Y方向半径
      const minBarLength = 10; // 条形最小长度
      const maxBarLength = 100; // 条形最大长度

      const bufferLength = analyser.value.frequencyBinCount;
      dataArray.value = new Uint8Array(bufferLength);
      console.log(bufferLength);

      const draw = () => {
        if (!isPlaying.value) return;

        analyser.value.getByteFrequencyData(dataArray.value);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const totalAngle = Math.PI * 2; // 360° 全圆
        const segmentAngle = ((totalAngle / bufferLength) * 4) / 3; // 每根条形所占的角度

        //取多少根采样
        for (let i = 0; i < 192; i++) {
          const value = Math.max(dataArray.value[i], 5);

          // 将条形长度限制在最小值和最大值之间
          const barLength = Math.min(
            maxBarLength,
            Math.max(minBarLength, value / 2)
          );

          // 将四分之三圆的数据展开到完整圆周
          const angle = i * segmentAngle; // 角度计算公式

          // 计算条形的起点坐标（圆周上的点）
          const x1 = centerX + Math.cos(angle) * radiusX;
          const y1 = centerY + Math.sin(angle) * radiusY;

          // 计算条形的终点坐标（圆周外延伸的点）
          const x2 = centerX + Math.cos(angle) * (radiusX + barLength);
          const y2 = centerY + Math.sin(angle) * (radiusY + barLength);

          // 创建渐变色
          const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
          gradient.addColorStop(0, "#cc53ae"); // 起点颜色
          gradient.addColorStop(1, "#22de9c"); // 终点颜色
          ctx.strokeStyle = gradient;

          // 设置线条的宽度
          ctx.lineWidth = 3;

          // 开始绘制条形
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        // 递归调用，持续更新画面
        requestAnimationFrame(draw);
      };

      draw();
    };

    // 初始化数据库
    onMounted(async () => {
      await openDB();
      const savedTracks = await getTracksFromDB();
      tracks.push(...savedTracks);

      const canvas = document.getElementById("visualizer") as HTMLCanvasElement;
      canvas.width = window.innerWidth; // 设置 canvas 宽度为窗口宽度
      canvas.height = window.innerHeight / 2; // 设置 canvas 高度为窗口高度的一半

      window.addEventListener("resize", () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight / 2;
      });
    });

    return {
      handleFileUpload,
      togglePlay,
      toggleLoopMode,
      prevTrack,
      nextTrack,
      removeTrack,
      isPlaying,
      tracks,
      currentTrackIndex,
      loopModes,
      currentLoopMode,
      playSpecificTrack,
      updateProgressDisplay,
      seekTrack,
      progress,
    };
  },
});
</script>

<style scoped>
.container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  width: 100vw;
  background: linear-gradient(to bottom, #372963, #000000);
  color: white;
}

.player {
  text-align: center;
  width: 100%;
  flex-direction: row;
  display: flex;
  justify-content: center;
}

canvas {
  background-color: transparent;
  display: block;
  width: 600px;
  height: 600px;
  margin-right: 100px;
}

.control_list {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.controls {
  margin-top: 100px;
  width: 30%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
}

button span.mdi,
.custom-file-upload span.mdi {
  font-size: 60px; /* 图标大小 */
  vertical-align: middle; /* 垂直居中 */
}

button {
  margin: 0 5px;
  padding: 10px 20px;
  font-size: 16px;
  background-color: transparent;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  width: 100px;
  border: none;
}

button:focus {
  outline: none; /* 确保点击聚焦时也没有白边 */
}

button:hover {
  background-color: #b6b6b636;
}

.custom-file-upload {
  display: inline-block;
  padding: 10px 20px;
  font-size: 16px;
  background-color: transparent;
  color: white;
  border: none;
  border-radius: 5px;
  cursor: pointer;
  margin: 0 5px;
  width: 100px;
}

.custom-file-upload:hover {
  background-color: #b6b6b636;
}

.custom-file-upload input {
  display: none;
}

.playlist {
  margin-top: 20px;
  text-align: left;
  width: 600px;
}

.playlist ul {
  list-style: none;
  padding: 0;
}

.playlist li {
  cursor: pointer;
  padding: 5px 5px 5px 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.playlist li.playing {
  background-color: #e6e6e63f;
}

.playlist li span {
  margin-left: 10px;
  cursor: pointer;
  font-size: 25px;
}

.progress-bar {
  width: 100%;
  margin: 10px 0;
  -webkit-appearance: none;
  background: #444;
  height: 5px;
  border-radius: 5px;
  cursor: pointer;
}

.progress-bar::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 15px;
  height: 15px;
  background: #ffffff;
  border-radius: 50%;
  cursor: pointer;
}

.progress-bar:hover {
  background: #666;
}
</style>
