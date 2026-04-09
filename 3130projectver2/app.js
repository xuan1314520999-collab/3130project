const { createApp } = Vue;

createApp({
    data() {
        return {
            isLoading: true,
            isLoadingSkeleton: true,
            currentTab: 'home',
            schools: [],
            searchQuery: '',
            selectedDistrict: '',
            selectedLevel: '',
            sortOption: 'distance-asc',
            currentSchool: null,
            compareList: [],
            map: null,
            // 增加错误处理，数据损坏时自动重置，避免应用崩溃
            favorites: (() => {
                try {
                return JSON.parse(localStorage.getItem('favorites') || '[]');
                } catch(e) {
                console.error("Failed to load favorites, reset to empty", e);
                return [];
                }
            })(),
            dataUpdated: false,
            districts: [], // 行政区列表（原有）
            userLocation: null
        }
    },
    computed: {
        filteredSchools() {
            let result = this.schools.filter(s => {
                const query = this.searchQuery.toLowerCase();
        
                const matchSearch =
                    !query ||
                    (s['ENGLISH NAME'] && s['ENGLISH NAME'].toLowerCase().includes(query));
                    (s['CHINESE NAME'] && s['CHINESE NAME'].includes(query));
        
                    const matchDistrict =!this.selectedDistrict ||
                    // 改为精确匹配，避免选了"North"却错误匹配到"North Point"的学校
                    (s['DISTRICT'] && s['DISTRICT'].toLowerCase() === this.selectedDistrict.toLowerCase());
        
                    const matchLevel =
                    !this.selectedLevel ||
                    // 修复：把错误的CATEGORY字段，改为正确的SCHOOL LEVEL字段，同时改为精确匹配
                    (s['SCHOOL LEVEL'] && s['SCHOOL LEVEL'].toLowerCase() === this.selectedLevel.toLowerCase());
        
                return matchSearch && matchDistrict && matchLevel;
            });
        
           
            // 替换原有排序代码
            if (this.sortOption === 'name') {
                result.sort((a, b) =>
                    (a['ENGLISH NAME'] || '').localeCompare(b['ENGLISH NAME'] || '')
                );
            } else if (this.sortOption === 'distance-asc') {
                // 由近到远排序（无距离的排最后）
                result.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
            } else if (this.sortOption === 'distance-desc') {
                // 由远到近排序（无距离的排最后）
                result.sort((a, b) => (b.distance || Infinity) - (a.distance || Infinity));
            }
        
            return result;
        }
    },
    methods: {
        // 6. Local Load + Async Update Strategy
        async loadData() {
            try {
                const localResponse = await fetch('./data.json');
                const localData = await localResponse.json();
                this.schools = localData;
                this.districts = [...new Set(localData.map(s => s['DISTRICT']).filter(Boolean))].sort();
                this.isLoadingSkeleton = false;

                if (this.userLocation) {
                    this.calculateAllDistances();
                }
        
                // ✅ 后台更新
                try {
                    // 修复：替换为正确的政府数据API，搭配CORS代理解决跨域问题
                    const apiUrl = 'https://api.allorigins.win/raw?url=https://resource.data.one.gov.hk/edb/sch_loc_edb.json';
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 8000);
                    
                    const apiResponse = await fetch(apiUrl, {
                        signal: controller.signal // 绑定超时控制器
                    });
                    clearTimeout(timeoutId);
                    if (apiResponse.ok) {
                        const apiData = await apiResponse.json();
                
                        // 优化更新判断：不仅判断长度，也判断内容，避免同长度下的更新漏检
                        const hasUpdate = apiData.length !== localData.length || JSON.stringify(apiData) !== JSON.stringify(localData);
                        if (hasUpdate) {
                            this.schools = apiData;
                            if (this.userLocation) {
                                this.calculateAllDistances();
                            }
                            this.dataUpdated = true;
                            setTimeout(() => {
                                this.dataUpdated = false;
                            }, 3000);
                        }
                    }
                } catch (e) {
                    console.log("API update failed", e);
                }
        
            } catch (error) {
                console.error(error);
                alert("Failed to load school data, please refresh the page.");
                this.isLoadingSkeleton = false;
            } finally {
                this.isLoading = false;
            }
        },

        calculateAllDistances() {
            if (!this.userLocation) return;
            this.schools.forEach(school => {
              if (school['LATITUDE'] && school['LONGITUDE']) {
                const schoolLat = parseFloat(school['LATITUDE']);
                const schoolLon = parseFloat(school['LONGITUDE']);
                // Haversine公式计算直线距离（米）
                const R = 6371e3;
                const φ1 = this.userLocation.lat * Math.PI/180;
                const φ2 = schoolLat * Math.PI/180;
                const Δφ = (schoolLat - this.userLocation.lat) * Math.PI/180;
                const Δλ = (schoolLon - this.userLocation.lon) * Math.PI/180;
                const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                        Math.cos(φ1) * Math.cos(φ2) *
                        Math.sin(Δλ/2) * Math.sin(Δλ/2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                school.distance = R * c; // 存储距离（米）
              } else {
                school.distance = Infinity; // 无位置数据的学校排最后
              }
            });
        },

        openDetail(school) {
            this.currentSchool = school;
            this.currentTab = 'detail';
            this.$nextTick(() => this.initMap(school)); // 替换原setTimeout
        },

        toggleFavorite(school) {
            const index = this.favorites.findIndex(s => s['SCHOOL NO.'] === school['SCHOOL NO.']);
        
            if (index > -1) {
                this.favorites.splice(index, 1);
            } else {
                
                this.favorites.push({...school});
            }
        
            
            this.favorites = [...this.favorites];
        
            localStorage.setItem('favorites', JSON.stringify(this.favorites));
        },

        isFavorite(school) {
            return this.favorites.some(s => s['SCHOOL NO.'] === school['SCHOOL NO.']);
        },

        isDifferent(field) {
            if (this.compareList.length < 2) return false;
            const values = this.compareList.map(s => s[field] || '');
            return new Set(values).size > 1;
        },

        closeDetail() {
            this.currentTab = 'home';
            this.currentSchool = null;
            if(this.map) { this.map.remove(); this.map = null; }
        },

        toggleCompare(school) {
            const index = this.compareList.findIndex(s => s['SCHOOL NO.'] === school['SCHOOL NO.']);
        
            if (index > -1) {
                this.compareList.splice(index, 1);
            } else {
                if (this.compareList.length >= 3) {
                    alert("You can compare up to 3 schools.");
                    return;
                }
                this.compareList.push({...school});
            }
        
            this.compareList = [...this.compareList];
        },

        isComparing(school) {
            return this.compareList.some(s => s['SCHOOL NO.'] === school['SCHOOL NO.']);
        },

        initMap(school) {
            const mapContainer = document.getElementById('map');
            // 修复：无位置数据时显示提示，避免用户看到空白疑惑
            if (!school['LATITUDE'] || !school['LONGITUDE']) {
                mapContainer.innerHTML = '<div class="empty-state">No location data available</div>';
                return;
            }
            const schoolLat = parseFloat(school['LATITUDE']);
            const schoolLon = parseFloat(school['LONGITUDE']);
            
            if (isNaN(schoolLat) || isNaN(schoolLon)) {
                mapContainer.innerHTML = '<div class="empty-state">Invalid location data</div>';
                return;
            }
        
            if (this.map) this.map.remove();
        
            this.map = L.map('map').setView([schoolLat, schoolLon], 16);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap'
            }).addTo(this.map);
        
            // 新增：地图弹窗加导航按钮，用户可以直接点击导航到学校
            const popupContent = `
                <b>${school['ENGLISH NAME']}</b><br>
                <a href="https://www.openstreetmap.org/directions?from=&to=${schoolLat},${schoolLon}" target="_blank">
                    <i class="fas fa-directions"></i> Navigate
                </a>
            `;
            L.marker([schoolLat, schoolLon]).addTo(this.map)
             .bindPopup(popupContent)
             .openPopup();
        
            // 新增：获取用户当前位置，自动计算你到学校的距离
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition((pos) => {
                    const userLat = pos.coords.latitude;
                    const userLon = pos.coords.longitude;
                    // Haversine公式计算两点间的直线距离（单位：米）
                    const R = 6371e3;
                    const φ1 = userLat * Math.PI/180;
                    const φ2 = schoolLat * Math.PI/180;
                    const Δφ = (schoolLat-userLat) * Math.PI/180;
                    const Δλ = (schoolLon-userLon) * Math.PI/180;
        
                    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                            Math.cos(φ1) * Math.cos(φ2) *
                            Math.sin(Δλ/2) * Math.sin(Δλ/2);
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                    const distance = R * c;
        
                    // 格式化距离，自动转km/m
                    this.currentSchool.distance = distance > 1000 
                        ? (distance/1000).toFixed(1) + ' km' 
                        : Math.round(distance) + ' m';
                }, (err) => {
                    console.log("Could not get user location", err);
                });
            }
        }
    },
    mounted() {
        // 获取用户定位（用于距离计算）
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition((pos) => {
            this.userLocation = {
              lat: pos.coords.latitude,
              lon: pos.coords.longitude
            };
            // 定位获取后重新计算距离并排序
            this.calculateAllDistances();
          }, (err) => {
            console.log("Could not get user location", err);
          });
        }
        this.loadData();
      },
     
}).mount('#app');


if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('Service Worker 注册成功!'))
      .catch((err) => console.log('注册失败: ', err));
  });
}