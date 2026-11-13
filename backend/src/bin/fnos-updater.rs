//! Fixed fnOS privileged update entry point; never accepts a package path.
#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).is_some_and(|arg| arg == "--help") {
        println!("ting-reader-updater: install | status");
        return;
    }
    if args.len() == 4 && args[1] == "--verify" {
        match ting_reader::update::validate_fpk(std::path::Path::new(&args[2]), &args[3]) {
            Ok(()) => println!("Package verified"),
            Err(error) => {
                eprintln!("{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    if !((args.len() == 2 && matches!(args[1].as_str(), "install" | "status"))
        || (args.len() == 3 && args[1] == "apply"))
    {
        std::process::exit(2);
    }
    match ting_reader::update::root_main(&args[1], args.get(2).map(String::as_str)).await {
        Ok(status) => println!("{}", serde_json::to_string(&status).unwrap_or_default()),
        Err(_) => {
            eprintln!("更新未能启动，请检查应用中心中的安装状态");
            std::process::exit(1);
        }
    }
}
