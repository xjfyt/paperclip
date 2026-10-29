fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        // This crate's library is an rlib; its final link targets (including
        // test harnesses) are standalone executables. Keep their PE exports,
        // but do not emit
        // unused import-library/.exp sidecars (or their linker progress output).
        // Real MSVC diagnostics and Rust's linker_messages lint remain enabled.
        println!("cargo:rustc-link-arg=/NOIMPLIB");
        println!("cargo:rustc-link-arg=/NOEXP");
    }
}
