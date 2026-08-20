# MLB Statcast Lab

2015年以降のMLB Statcastを、スマホ対応のGitHub Pagesで分析する公開ダッシュボードです。

## 主な分析

- リーグ環境：球速、回転数、打球速度、Hard-hit、Barrel、Whiff、CSW
- 打者：AVG、OBP、SLG、HR、K、BB、EV、打球角度、xwOBA
- 投手：K%、BB%、球速、回転数、Whiff%、CSW%、xwOBA
- 球種：使用率、球速、回転、縦横変化、Whiff%
- 日次トレンド、選手比較、欠損率、指標ガイド、共有URL
- 詳細な任意期間分析はStreamlit版へ接続予定

## 自動更新

GitHub Actionsが毎日17:20（日本時間）に当年Statcastを取得し、当年集計を差し替えます。当年の原データはGitHub Releaseの`data-current`へ保存し、過去全量の原本はGoogle Driveで保管します。すべて無料枠で動作します。

手動更新はActionsの`Daily Statcast update`から`Run workflow`を実行します。
