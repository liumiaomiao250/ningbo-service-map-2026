# 宁波市不动产登记服务地图

这是根据《宁波市不动产登记服务网点查询系统（宁波市不动产登记服务地图）需求说明书》制作的第一版可运行原型。

## 当前已完成

- 读取桌面 `服务点统计` 文件夹内 12 份 `.xls` 数据
- 统一生成 2,168 条服务网点和村级代办点数据
- 地图、列表双视图
- 按区域、网点类型、运营状态筛选
- 按网点名称、地址、乡镇和业务关键词搜索
- 网点详情抽屉、电话和地址操作
- 当前定位入口
- 管理台原型、数据统计、Excel 导入入口、JSON 数据导出
- PostgreSQL + PostGIS 兼容的数据字段预留
- 高德地图 JS API 2.0 接入，支持 Key 和安全密钥配置

## 启动

双击 `启动系统.bat`，或在当前目录打开终端执行：

```powershell
npm.cmd run dev:lan -- --port 4173
```

浏览器访问：

```text
http://127.0.0.1:4173/
```

## 生成扫码二维码

双击 `生成扫码二维码.bat`，系统会在 `二维码` 文件夹中生成：

```text
宁波不动产登记服务地图-扫码访问.png
```

手机扫码访问时，手机和电脑必须连接同一个 Wi-Fi。电脑启动系统时如果弹出 Windows 防火墙提示，请选择允许专用网络访问。

## 目录

- `src/`：前端页面和样式
- `public/data/service-points.json`：从 Excel 生成的初始数据
- `scripts/build-data.mjs`：重新导入桌面 Excel 的脚本
- `backend/`：后端工程骨架，后续可在 IntelliJ IDEA 中继续接入 PostgreSQL

## 重新导入 Excel

如果桌面上的统计表发生更新，在项目目录执行：

```powershell
node .\scripts\build-data.mjs
```

## 高德地图配置

项目使用 `.env.local` 配置高德地图：

```text
VITE_AMAP_KEY=高德 Web 端（JS API）Key
VITE_AMAP_SECURITY_CODE=高德安全密钥 securityJsCode
AMAP_WEB_SERVICE_KEY=高德 Web服务 API Key，可选，用于批量地址解析校准坐标
```

高德控制台需要将本地开发地址加入 Web 端（JS API）Key 的域名白名单：

```text
http://127.0.0.1:4173
http://localhost:4173
```

正式部署时，把正式域名加入白名单，并重新启动 Vite。

## 定位准确性说明

系统中的定位分为两类：

1. 用户当前位置定位：前端已使用高德 `AMap.Geolocation` 插件，并开启高精度定位。手机端要获得 GPS 精准定位，建议使用 HTTPS 正式地址；局域网 `http://IP:端口` 在部分手机浏览器中可能无法获得高精度权限。
2. 服务网点点位定位：正式上线前应通过高德地理编码或人工核验经纬度，把每个网点地址转换为准确坐标后保存到数据中。

如果要批量校准网点坐标，请先准备高德 Web服务 API Key，并写入 `.env.local`：

```text
AMAP_WEB_SERVICE_KEY=你的高德Web服务Key
```

然后双击：

```text
校准网点坐标.bat
```

脚本会生成：

```text
public/data/service-points.geocoded.json
public/data/geocode-report.json
```

## 说明

当前点位坐标先按区域中心和村级点位做了初始化偏移。正式部署时应接入宁波市自然资源“一张图”或高德正式地图服务，并将坐标字段替换为准确坐标。
