//填充efi磁盘下拉列表框
function add_select_efi_drives(stdout) {
  const arrayRes = stdout.split("\n");

  for (let i = 0; i < arrayRes.length; i++) {
    const itval = arrayRes[i].split(/\s{2,}/);
    if (itval.length === 5 && itval[2].indexOf("EFI") === 0) {
      const option = {
        text: itval[2].substr(itval[2].indexOf("EFI") + 4) + " " + itval[4],
        value: itval[4],
        partitionname:itval[2].substr(itval[2].indexOf("EFI") + 4),
        ismounted : false
      };
      VUEAPP.select_efi_drives.options.push(option);
      check_disk_ismounted(option);
      if(VUEAPP.select_efi_drives.selected.length === 0) VUEAPP.select_efi_drives.selected = itval[4];

    }
  }
}

//检测下来框中的 EFI 磁盘是否已经挂载
async function check_disk_ismounted(diskoption) {
  const { Command } = window.__TAURI__.shell;

    let result = await Command.create('run-check-diskmouted', ['-c', "mount |grep " + diskoption.value]).execute();

    if(result.stdout.length > 0) {
      const selectedOption = VUEAPP.select_efi_drives.options.find(it=>it.value === diskoption.value);
      selectedOption.ismounted = true;
    }
    
}

//运行 diskutil list 命令获取 efi 磁盘信息
async function getEFIdiskName_MT () {
    const { Command } = window.__TAURI__.shell;
    const shellresult = await Command.create('run-diskutil-list', ['list']).execute();
    add_select_efi_drives(shellresult.stdout);
}

//挂载选定的 EFI 磁盘
async function mountEFIDisk_MT () {
  const BSDname = VUEAPP.select_efi_drives.selected;
  if (BSDname === "") {
    toastr.error(VUEAPP.lang.tip_no_mount_disk);
    return;
  }

  const selectedOption = VUEAPP.select_efi_drives.options.find(it=>it.value === BSDname);
  
  if(selectedOption.ismounted) {
    toastr.error(VUEAPP.lang.tip_mount_disk_ismounted);
    return;
  }


  const { invoke } = window.__TAURI__.core;
  const abc = await invoke("mount_efi_disk", { diskname: `/dev/${BSDname}` });
  selectedOption.ismounted = true;
}

//弹出文件选择框, 并调用 读取文件内容, 初始化界面数据 函数
async function openconfigfile() {
  const { open } = window.__TAURI__.dialog;
  const selected = await open({
    multiple: false,
    filters: [{
      name: 'Opencore config file',
      extensions: ['plist']
    }]
  });
  //console.log(selected)
  if(typeof selected === 'string') {
    VUEAPP.tauri_file_choose = VUEAPP.lang.change;
    const arrselected = selected.split('/');
    VUEAPP.tauri_file_path = arrselected[arrselected.length-1];
    VUEAPP.open_file_path = selected
    readconfigfile(selected);
  }
}

//读取文件内容, 初始化界面数据
async function readconfigfile(open_file_path) {
  const { invoke } = window.__TAURI__.core;
  //console.log(open_file_path)
  const content = await invoke("read_file_to_string", { filepath: open_file_path});
  VUEAPP["plistJsonObject"] = formatContext(content);
  VUEAPP.initAllData();
}

//保存修改后的内容到文件中
async function savePlistTauri() {
  if(VUEAPP.open_file_path === '') {
    toastr.error(VUEAPP.lang.tip_file_save_failed);
    return;
  }
  const cotstring = checkOneditTable();
  if (cotstring !== "") {
    toastr.error(cotstring);
    return;
    
  } else {
    const xmlcontext = getAllPlist();
    const { invoke } = window.__TAURI__.core;
    const saveresult = await invoke("save_file", { filepath: VUEAPP.open_file_path,content:xmlcontext});
    //console.log(saveresult);
    if(saveresult === 'Ok') {
      showTipModal(VUEAPP.lang.tip_file_save_success, "success");
    } else {
      showTipModal(saveresult, "error");
    }
    
  }
  
}

//升级 Opencore 程序
function upgradeOpencore_MT() {
  //先检查 EFI 分区是否已经挂载，如果没有挂载就提示挂载
  const selectedOption = VUEAPP.select_efi_drives.options.find(it=>it.value === VUEAPP.select_efi_drives.selected);
  if(!selectedOption.ismounted) {
    showTipModal(fillLangString(VUEAPP.lang.tip_EFI_partition_not_exist, selectedOption.partitionname),'error');
    return;
  }
  getAndSetDatajson();
  bootbox.confirm("<div style='font-size:18px'>" + fillLangString(VUEAPP.lang.tip_is_continue_upgrading_opencore,selectedOption.partitionname) + "</div>", function(result) {
    if(result) {
      asyncupgradeOpencore(`/Volumes/${selectedOption.partitionname}/EFI`);
    }
  });

  

}

async function asyncupgradeOpencore(diskno) {


  $('body').css('cursor', 'progress');

  const  { tempDir } = window.__TAURI__.path;
  const  { invoke } = window.__TAURI__.core;
  const tempPath = await tempDir();
  
  const unzipPath = `${tempPath}OpenCore-${VUEAPP.opencore_latest_version}-RELEASE`;
  const zipfilePath = `${tempPath}OpenCore-${VUEAPP.opencore_latest_version}-RELEASE.zip`;
  console.log(zipfilePath)
  showTipModal("开始下载文件");


  const saveresult = await invoke("get_file_size", { filepath: zipfilePath});
  if(saveresult < 8000000) {
    console.log("文件不存在,需要下载")
    const durl = `${VUEAPP.download_proxy_url}/https://github.com/acidanthera/OpenCorePkg/releases/download/${VUEAPP.opencore_latest_version}/OpenCore-${VUEAPP.opencore_latest_version}-RELEASE.zip`;
    console.log(durl)
    const download = await invoke("download_file", { url: durl, outputdir:tempPath});
    if(download === 0) {
      showTipModal(VUEAPP.lang.tip_file_download_failed,'error');
      return;
    }
  }

  //开始解压文件
  const unzipres = await invoke("unzip_file_to_dir", { zippath: zipfilePath, destdir:unzipPath});  

  //开始更新 BOOT 目录下文件
  const bootfilelist = await invoke("list_files_in_dir", { dirpath: diskno + "/BOOT"});  
  const bootfilejson = JSON.parse(bootfilelist);  
  for(const it of bootfilejson.files) {
    const copyfileres = await invoke("copy_file_to_dir", { srcfile: unzipPath + "/X64/EFI/BOOT/"+it, destdir:diskno+'/BOOT'});
    if(copyfileres === 'Ok') {
      showTipModal(fillLangString(VUEAPP.lang.tip_file_upgrade_success,it));
    }
  }

  //开始更新 OC 目录下文件
  const ocfilelist = await invoke("list_files_in_dir", { dirpath: diskno + "/OC"});
  const ocfilejson = JSON.parse(ocfilelist);
  for(const it of ocfilejson.files) {
    const copyfileres = await invoke("copy_file_to_dir", { srcfile: unzipPath + "/X64/EFI/OC/"+it, destdir:diskno+'/OC'});
    if(copyfileres === 'Ok') {
      showTipModal(fillLangString(VUEAPP.lang.tip_file_upgrade_success,it));
    }
  }

  $('body').css('cursor', '');

}


