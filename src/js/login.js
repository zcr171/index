// 检查登录状态
function checkLoginStatus() {
    const token = localStorage.getItem('token');
    const userRole = localStorage.getItem('userRole');
    const loginUser = localStorage.getItem('loginUser');
    
    if (token && userRole) {
        console.log('检测到已登录状态，自动恢复登录...');
        
        // 更新登录人信息
        const loginUserElement = document.getElementById('login-user');
        if (loginUserElement) {
            loginUserElement.textContent = loginUser || 'admin';
        }
        
        // 隐藏登录界面，显示主系统界面
        const loginPage = document.getElementById('login-page');
        const mainPage = document.getElementById('main-page');
        
        if (loginPage && mainPage) {
            loginPage.classList.add('hidden');
            mainPage.classList.remove('hidden');
            
            // 默认进入综合概况画面
            setTimeout(function() {
                const overviewMenuItem = document.querySelector('.menu-item[data-target="overview"]');
                if (overviewMenuItem) {
                    // 模拟点击综合概况菜单
                    overviewMenuItem.click();
                }
            }, 100);
            
            // 登录成功后开始检查数据库状态
            startMySQLStatusCheck();
        }
    }
}

// 初始化登录功能
function initLoginFunctionality() {
    try {
        console.log('初始化登录功能');
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            console.log('登录按钮找到，绑定点击事件');
            
            // 添加点击事件监听器
            loginBtn.addEventListener('click', function() {
                try {
                    console.log('登录按钮点击事件触发');
                    
                    // 获取用户名和密码
                    const username = document.getElementById('login-username').value;
                    const password = document.getElementById('login-password').value;
                    
                    console.log('用户名:', username, '密码:', password ? '***' : '');
                    
                    // 登录验证
                    if (username && password) {
                        console.log('登录验证通过，开始进入系统');
                        
                        // 显示加载状态
                        loginBtn.disabled = true;
                        loginBtn.innerHTML = '<i class="fa fa-spinner fa-spin mr-1"></i> 登录中...';
                        
                        // 存储登录信息
                        localStorage.setItem('token', 'mock-token');
                        localStorage.setItem('userRole', 'admin');
                        localStorage.setItem('loginUser', username);
                        
                        // 更新登录人信息
                        const loginUserElement = document.getElementById('login-user');
                        if (loginUserElement) {
                            loginUserElement.textContent = username;
                        }
                        
                        // 隐藏登录界面，显示主系统界面
                        const loginPage = document.getElementById('login-page');
                        const mainPage = document.getElementById('main-page');
                        if (loginPage && mainPage) {
                            console.log('切换页面：隐藏登录页，显示主页');
                            loginPage.classList.add('hidden');
                            mainPage.classList.remove('hidden');
                            
                            // 默认进入综合概况画面
                            setTimeout(function() {
                                const overviewMenuItem = document.querySelector('.menu-item[data-target="overview"]');
                                if (overviewMenuItem) {
                                    console.log('模拟点击综合概况菜单');
                                    overviewMenuItem.click();
                                }
                            }, 100);
                            
                            // 登录成功后开始检查数据库状态
                            if (typeof startMySQLStatusCheck === 'function') {
                                console.log('开始检查数据库状态');
                                startMySQLStatusCheck();
                            }
                            
                            // 登录成功后自动连接MQTT服务器
                            console.log('登录成功，开始连接MQTT服务器...');
                            if (typeof connectMQTT === 'function') {
                                connectMQTT();
                            }
                        } else {
                            console.error('登录页面或主页面元素未找到');
                            alert('页面元素加载失败，请刷新页面重试');
                        }
                        
                        // 恢复登录按钮状态
                        loginBtn.disabled = false;
                        loginBtn.innerHTML = '<i class="fa fa-sign-in mr-1"></i> 登录';
                    } else {
                        console.log('用户名或密码为空');
                        alert('请输入用户名和密码');
                    }
                } catch (error) {
                    console.error('登录点击事件错误:', error);
                    alert('登录过程中发生错误，请刷新页面重试');
                    
                    // 恢复登录按钮状态
                    loginBtn.disabled = false;
                    loginBtn.innerHTML = '<i class="fa fa-sign-in mr-1"></i> 登录';
                }
            });
        } else {
            console.log('登录按钮未找到');
            alert('登录按钮加载失败，请刷新页面重试');
        }
        
        // 初始化注销功能
        if (typeof initLogoutFunctionality === 'function') {
            initLogoutFunctionality();
        }
    } catch (error) {
        console.error('初始化登录功能错误:', error);
        alert('登录功能初始化失败，请刷新页面重试');
    }
}

// 初始化注销功能
function initLogoutFunctionality() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function() {
            // 显示确认对话框
            if (confirm('确定要注销账号吗？')) {
                console.log('用户注销');
                
                // 清除localStorage中的登录信息
                localStorage.removeItem('token');
                localStorage.removeItem('userRole');
                localStorage.removeItem('loginUser');
                console.log('已清除登录状态');
                
                // 重置登录人信息
                document.getElementById('login-user').textContent = '未登录';
                
                // 重置登录表单
                document.getElementById('login-username').value = '';
                document.getElementById('login-password').value = '';
                document.getElementById('remember-me').checked = false;
                
                // 显示登录界面，隐藏主系统界面
                document.getElementById('main-page').classList.add('hidden');
                document.getElementById('login-page').classList.remove('hidden');
            }
        });
    }
}
