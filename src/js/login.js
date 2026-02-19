// 检查登录状态
function checkLoginStatus() {
    const token = localStorage.getItem('token');
    const userRole = localStorage.getItem('userRole');
    const loginUser = localStorage.getItem('loginUser');
    
    if (token && userRole) {
        console.log('检测到已登录状态...');
        
        // 更新登录人信息
        const loginUserElement = document.getElementById('login-user');
        if (loginUserElement) {
            loginUserElement.textContent = loginUser || 'admin';
        }
        
        // 检查是否在主页面
        const mainPage = document.getElementById('main-page');
        if (mainPage) {
            // 在主页面，执行主页面初始化
            console.log('在主页面，执行初始化');
            
            // 默认进入综合概况画面
            setTimeout(function() {
                const overviewMenuItem = document.querySelector('.menu-item[data-target="overview"]');
                if (overviewMenuItem) {
                    // 模拟点击综合概况菜单
                    overviewMenuItem.click();
                }
            }, 100);
            
            // 登录成功后开始检查数据库状态
            if (typeof startMySQLStatusCheck === 'function') {
                startMySQLStatusCheck();
            }
        }
    }
}

// 初始化登录功能
function initLoginFunctionality() {
    try {
        console.log('初始化登录功能');
        
        // 检查当前页面是否包含登录按钮
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
            // 在登录页面，绑定登录事件
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
                        
                        // 调用后端登录API
                        fetch(`${API_BASE_URL}/login`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ username, password })
                        })
                        .then(response => {
                            if (!response.ok) {
                                throw new Error('登录失败，服务器响应错误');
                            }
                            return response.json();
                        })
                        .then(data => {
                            if (data.success) {
                                console.log('后端登录成功:', data);
                                
                                // 存储登录信息
                                localStorage.setItem('token', data.token);
                                localStorage.setItem('userRole', data.user.role);
                                localStorage.setItem('loginUser', data.user.username);
                                
                                // 登录成功后跳转到主页面
                                console.log('登录成功，跳转到主页面');
                                window.location.href = '/index.html';
                            } else {
                                console.error('后端登录失败:', data.message);
                                alert('登录失败: ' + data.message);
                            }
                        })
                        .catch(error => {
                            console.error('登录请求失败:', error);
                            alert('登录失败，请检查网络连接或服务器状态');
                        })
                        .finally(() => {
                            // 恢复登录按钮状态
                            loginBtn.disabled = false;
                            loginBtn.innerHTML = '<i class="fa fa-sign-in mr-1"></i> 登录';
                        });
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
            // 在主页面，不显示错误提示
            console.log('登录按钮未找到，可能在主页面');
        }
        
        // 初始化注销功能
        if (typeof initLogoutFunctionality === 'function') {
            initLogoutFunctionality();
        }
    } catch (error) {
        console.error('初始化登录功能错误:', error);
        // 只在登录页面显示错误提示
        if (document.getElementById('login-btn')) {
            alert('登录功能初始化失败，请刷新页面重试');
        }
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
                const loginUserElement = document.getElementById('login-user');
                if (loginUserElement) {
                    loginUserElement.textContent = '未登录';
                }
                
                // 跳转到登录页面
                window.location.href = '/src/pages/login.html';
            }
        });
    }
}
