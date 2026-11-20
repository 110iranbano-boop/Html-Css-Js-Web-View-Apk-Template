/* Supabase data adapter for Café-Book Simorgh.
 * Public publishable key only. Never put a service_role key in this file.
 */
(() => {
  const cfg = window.APP_CONFIG || {};
  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    console.error("Supabase configuration is missing.");
    window.SimorghDB = { ready:false, api: async()=>({ok:false,d:{error:"تنظیمات Supabase کامل نیست"}}) };
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true }
  });
  window.sb = sb;
  const digits = v => String(v||"").replace(/[۰-۹]/g,d=>"۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/[٠-٩]/g,d=>"٠١٢٣٤٥٦٧٨٩".indexOf(d));
  const phoneE164 = v => {
    let p=digits(v).replace(/[^\d+]/g,"");
    if(p.startsWith("+")) return p;
    if(p.startsWith("0098")) return "+"+p.slice(2);
    if(p.startsWith("98")) return "+"+p;
    if(p.startsWith("0")) return "+98"+p.slice(1);
    return "+98"+p;
  };
  const fail = e => ({ok:false,d:{error:e?.message || "عملیات انجام نشد"}});
  const ok = d => ({ok:true,d});
  async function userContext(){
    const {data:{user},error}=await sb.auth.getUser();
    if(error||!user) throw new Error("ابتدا وارد حساب شوید");
    const [{data:profile,error:pe},{data:roles,error:re},{data:forumPermission,error:fe}] = await Promise.all([
      sb.from("profiles").select("*").eq("id",user.id).maybeSingle(),
      sb.from("user_roles").select("role").eq("user_id",user.id),
      sb.from("forum_permissions").select("can_create_topic").eq("user_id",user.id).maybeSingle()
    ]);
    if(pe) throw pe; if(re) throw re; if(fe && fe.code!=="PGRST116") throw fe;
    const roleRows=roles||[];
    const role=roleRows.some(x=>["super_admin","admin","manager"].includes(x.role))?"admin":"user";
    return {authUser:user,profile:profile||{},roles:roleRows,user:{
      id:user.id, phone:profile?.phone || user.phone || user.user_metadata?.phone || "",
      full_name:profile?.display_name || user.user_metadata?.full_name || user.user_metadata?.display_name || "",
      username:profile?.username || "", avatar_url:profile?.avatar_url || "",
      avatar_key:profile?.avatar_key || "", bio:profile?.bio || "",
      role, member_code:"S-"+user.id.slice(0,8).toUpperCase(),
      is_suspended:!!profile?.is_suspended,
      can_create_topic:!!profile?.can_create_topic||!!forumPermission?.can_create_topic, is_super_admin:roleRows.some(x=>x.role==="super_admin")
    }};
  }
  const getProfile = async id => {
    const {data,error}=await sb.from("profiles").select("*").eq("id",id).single();
    if(error) throw error; return data;
  };
  const rows = async (table,select="*") => {
    const {data,error}=await sb.from(table).select(select);
    if(error) throw error; return data||[];
  };
  const single = async (table,payload) => {
    const {data,error}=await sb.from(table).insert(payload).select().single();
    if(error) throw error; return data;
  };
  const update = async (table,id,payload) => {
    const {data,error}=await sb.from(table).update(payload).eq("id",id).select().single();
    if(error) throw error; return data;
  };
  const softDelete = async (table,id,field="is_active") => {
    const {error}=await sb.from(table).update({[field]:false}).eq("id",id);
    if(error) throw error; return {ok:true};
  };
  const categoryId = async (table,name) => {
    if(!name) return null;
    const {data,error}=await sb.from(table).select("id").eq("name",name).maybeSingle();
    if(error) throw error;
    if(data) return data.id;
    const {data:created,error:ce}=await sb.from(table).insert({name}).select("id").single();
    if(ce) throw ce; return created.id;
  };
  const profileName = async id => {
    const {data,error}=await sb.from("profiles").select("display_name,username,avatar_url,is_suspended").eq("id",id).maybeSingle();
    if(error) throw error; return data||{};
  };
  async function login(body){
    const {data,error}=await sb.auth.signInWithPassword({phone:phoneE164(body.phone),password:String(body.password||"")});
    if(error) throw error;
    const ctx=await userContext();
    return {token:data.session?.access_token||"",user:{...ctx.user,phone:digits(body.phone)}};
  }
  async function register(body){
    const {data,error}=await sb.auth.signUp({
      phone:phoneE164(body.phone),password:String(body.password||""),
      options:{data:{full_name:String(body.full_name||"").trim(),display_name:String(body.full_name||"").trim()}}
    });
    if(error) throw error;
    if(data.user && data.session){
      const {error:pe}=await sb.from("profiles").upsert({id:data.user.id,display_name:String(body.full_name||"").trim(),phone:phoneE164(body.phone)},{onConflict:"id"});
      if(pe) throw pe;
    }
    return {created:true,session_created:!!data.session};
  }
  async function api(path,method="GET",body){
    const p=path.split("?")[0];
    if(p==="/login"&&method==="POST") return ok(await login(body||{}));
    if(p==="/register"&&method==="POST") return ok(await register(body||{}));
    const ctx=await userContext(),uid=ctx.authUser.id;
    if(ctx.profile.is_suspended && !p.startsWith("/profile") && !p.startsWith("/notifications") && !p.startsWith("/books") && !p.startsWith("/menu") && !p.startsWith("/events") && !p.startsWith("/art")) throw new Error("حساب شما تعلیق شده است؛ فقط امکان مشاهده محتوا را دارید");
    if(p==="/menu"&&method==="GET"){
      const data=await rows("cafe_products","*,category:cafe_categories(name)");
      return ok(data.filter(x=>x.is_available).map(x=>({id:x.id,name:x.name,description:x.description,price:x.price_toman,image_url:x.image_path,category:x.category?.name||"سایر"})));
    }
    if(p==="/books"&&method==="GET"){
      const data=await rows("books","*,category:book_categories(name)");
      return ok(data.filter(x=>x.is_active).map(x=>({id:x.id,title:x.title,author:x.author,description:x.description,category:x.category?.name||"",type:x.book_type==="both"?"sale":x.book_type,status:x.available_copies>0?"available":"loaned",price:x.sale_price_toman,image_url:x.cover_path})));
    }
    if(p==="/loan-requests/my"&&method==="GET"){
      const [reqs,loans]=await Promise.all([
        sb.from("book_requests").select("id,book_id,request_type,status,created_at").eq("user_id",uid).eq("request_type","borrow").order("created_at",{ascending:false}),
        sb.from("book_loans").select("id,book_id,status,handed_over_at,current_due_at,returned_at,book:books(title)").eq("user_id",uid).is("returned_at",null)
      ]);
      if(reqs.error) throw reqs.error;if(loans.error) throw loans.error;
      return ok([...(reqs.data||[]).map(x=>({id:x.id,book_id:x.book_id,status:x.status==="pending"?"pending":x.status,kind:"request"})),...(loans.data||[]).map(x=>({id:x.id,book_id:x.book_id,status:"approved",book_title:x.book?.title,due_at:x.current_due_at,kind:"loan"}))]);
    }
    if(p==="/loan-requests"&&method==="POST"){
      const amount=Number(body?.proposed_amount_toman||body?.amount||0);
      const {data,error}=await sb.rpc("request_book_loan",{p_book_id:Number(body.book_id),p_amount_toman:amount});
      if(error) throw error; return ok({id:data});
    }
    if(p==="/book-requests/my"&&method==="GET"){
      const {data,error}=await sb.from("book_requests").select("*").eq("user_id",uid).in("request_type",["suggestion","acquisition"]).order("created_at",{ascending:false});
      if(error) throw error;
      return ok((data||[]).map(x=>({id:x.id,book_title:x.requested_title,author:x.requested_author,status:x.status,admin_note:x.admin_note,created_at:x.created_at})));
    }
    if(p==="/book-requests"&&method==="POST"){
      await single("book_requests",{user_id:uid,request_type:"suggestion",requested_title:String(body.book_title||"").trim(),requested_author:body.author||null,message:body.description||null});
      return ok({ok:true});
    }
    if(p==="/events"&&method==="GET"){
      const [ev,reg]=await Promise.all([
        sb.from("events").select("*").eq("status","published").order("starts_at",{ascending:true}),
        sb.from("event_registrations").select("event_id,people_count,status").eq("user_id",uid)
      ]);
      if(ev.error) throw ev.error;if(reg.error) throw reg.error;
      const regs=reg.data||[];
      const mapped=(ev.data||[]).map(e=>({id:e.id,title:e.title,description:e.description,event_date:e.starts_at,image_url:e.poster_path,location:e.location||"",capacity:e.capacity_people,required_teammates:e.required_teammates,event_type:e.event_type,registration_open:e.event_type==="timed"&&e.is_registration_open,mine:regs.some(r=>r.event_id===e.id&&r.status==="registered"),registered:regs.filter(r=>r.event_id===e.id&&r.status==="registered").reduce((n,r)=>n+r.people_count,0),points:e.points_on_registration,rules_text:e.rules_text}));
      return ok(mapped);
    }
    const regMatch=p.match(/^\/events\/(\d+)\/register$/);
    if(regMatch&&method==="POST"){
      const {data,error}=await sb.rpc("register_for_event",{p_event_id:Number(regMatch[1]),p_registrant_name:body.registrant_name||ctx.user.full_name,p_registrant_phone:phoneE164(body.registrant_phone||ctx.user.phone),p_teammates:body.teammates||[]});
      if(error) throw error; return ok({id:data});
    }
    if(regMatch&&method==="DELETE"){
      const {data:reg,error:re}=await sb.from("event_registrations").select("id").eq("event_id",Number(regMatch[1])).eq("user_id",uid).eq("status","registered").single();if(re)throw re;
      const {data,error}=await sb.rpc("cancel_event_registration",{p_registration_id:reg.id});if(error)throw error;return ok({ok:true});
    }
    if(p==="/art"&&method==="GET"){
      const data=await rows("store_products","*,category:store_categories(name)");
      return ok(data.filter(x=>x.is_available).map(x=>({id:x.id,name:x.name,category:x.category?.name||"سایر",description:x.description,price:x.price_toman,image_url:x.image_path,stock_status:"in_stock",allow_custom:false})));
    }
    if(p==="/purchase-requests/my"&&method==="GET"){
      const {data,error}=await sb.from("purchase_requests").select("*,book:books(title),product:store_products(name)").eq("user_id",uid).order("created_at",{ascending:false});
      if(error) throw error;
      return ok((data||[]).map(x=>({id:x.id,status:x.status,created_at:x.created_at,final_price:null,admin_note:x.admin_note,items:[{title:x.item_name_snapshot,qty:x.quantity,price:x.unit_price_toman_snapshot}]})));
    }
    if(p==="/purchase-requests"&&method==="POST"){
      const phone=phoneE164(body.contact_phone||ctx.user.phone);
      const items=Array.isArray(body.items)?body.items:[];
      if(!items.length) throw new Error("سبد خرید خالی است");
      const inserts=[];
      for(const item of items){
        if(item.type==="book"){
          const {data,error}=await sb.from("books").select("id,title,sale_price_toman").eq("id",item.id).eq("is_active",true).single();if(error)throw error;
          inserts.push({user_id:uid,book_id:data.id,item_name_snapshot:data.title,unit_price_toman_snapshot:data.sale_price_toman||0,quantity:Math.max(1,Number(item.qty)||1),status:"pending"});
        }else{
          const {data,error}=await sb.from("store_products").select("id,name,price_toman").eq("id",item.id).eq("is_available",true).single();if(error)throw error;
          inserts.push({user_id:uid,store_product_id:data.id,item_name_snapshot:data.name,unit_price_toman_snapshot:data.price_toman||0,quantity:Math.max(1,Number(item.qty)||1),status:"pending"});
        }
      }
      for(const row of inserts){row.contact_phone=phone;row.note=body.note||null;}
      const {error}=await sb.from("purchase_requests").insert(inserts);if(error)throw error;
      return ok({ok:true});
    }
    if(p==="/notifications"&&method==="GET"){
      const data=await rows("notifications");
      return ok(data.filter(x=>x.user_id===uid).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)));
    }
    if(p==="/notifications/read"&&method==="PUT"){
      const {error}=await sb.from("notifications").update({is_read:true,read_at:new Date().toISOString()}).eq("user_id",uid).eq("is_read",false);
      if(error) throw error; return ok({ok:true});
    }
    if(p==="/profile"&&method==="PUT"){
      const {data,error}=await sb.from("profiles").update({display_name:String(body.full_name||"").trim()}).eq("id",uid).select().single();
      if(error) throw error; return ok({...ctx.user,full_name:data.display_name});
    }
    if(p==="/admin/purchase-requests"&&method==="GET"){
      const {data,error}=await sb.from("purchase_requests").select("*,profile:profiles!purchase_requests_user_id_fkey(display_name),book:books(title),product:store_products(name)").order("created_at",{ascending:false}).limit(200);
      if(error) throw error;
      return ok((data||[]).map(x=>({id:x.id,status:x.status,full_name:x.profile?.display_name||"عضو",contact_phone:"",items:[{title:x.item_name_snapshot,qty:x.quantity,price:x.unit_price_toman_snapshot}],admin_note:x.admin_note,final_price:null,note:""})));
    }
    let m=p.match(/^\/admin\/purchase-requests\/([^/]+)$/);
    if(m&&method==="PUT"){
      const patch={}; if(body.status)patch.status=body.status;if("admin_note" in body)patch.admin_note=body.admin_note;
      const {error}=await sb.from("purchase_requests").update(patch).eq("id",m[1]);if(error)throw error;return ok({ok:true});
    }
    if(p==="/admin/loan-requests"&&method==="GET"){
      const {data,error}=await sb.from("book_requests").select("*,book:books(title),profile:profiles(display_name)").eq("request_type","borrow").order("created_at",{ascending:false});
      if(error)throw error;
      return ok((data||[]).map(x=>({id:x.id,book_id:x.book_id,book_title:x.book?.title||"",full_name:x.profile?.display_name||"",phone:"",status:x.status,proposed_amount_toman:x.proposed_amount_toman})));
    }
    m=p.match(/^\/admin\/loan-requests\/([^/]+)$/);
    if(m&&method==="PUT"){
      const {data,error}=await sb.rpc("review_book_loan_request",{p_request_id:m[1],p_approve:body.status==="approved",p_admin_note:body.admin_note||null});
      if(error)throw error;return ok({id:data});
    }
    if(p==="/admin/book-requests"&&method==="GET"){
      const {data,error}=await sb.from("book_requests").select("*,profile:profiles(display_name)").in("request_type",["suggestion","acquisition"]).order("created_at",{ascending:false});
      if(error)throw error;return ok((data||[]).map(x=>({id:x.id,book_title:x.requested_title,author:x.requested_author,description:x.message,full_name:x.profile?.display_name||"",phone:"",status:x.status,admin_note:x.admin_note})));
    }
    m=p.match(/^\/admin\/book-requests\/([^/]+)$/);
    if(m&&method==="PUT"){
      const patch={};if(body.status)patch.status=body.status;if("admin_note" in body)patch.admin_note=body.admin_note;
      const {error}=await sb.from("book_requests").update({...patch,reviewed_by:uid,reviewed_at:new Date().toISOString()}).eq("id",m[1]);if(error)throw error;return ok({ok:true});
    }
    if(p==="/admin/events"&&method==="GET") return ok((await rows("events")).map(x=>({...x,event_date:x.starts_at,capacity:x.capacity_people,registration_open:x.is_registration_open,image_url:x.poster_path,active:x.status==="published"})));
    if(p==="/admin/books"&&method==="GET") return ok((await rows("books")).map(x=>({...x,type:x.book_type==="both"?"sale":x.book_type,status:x.available_copies>0?"available":"loaned",price:x.sale_price_toman,image_url:x.cover_path,active:x.is_active})));
    if(p==="/admin/menu"&&method==="GET") return ok((await rows("cafe_products","*,category:cafe_categories(name)")).map(x=>({...x,category:x.category?.name||"",price:x.price_toman,image_url:x.image_path,active:x.is_available})));
    if(p==="/admin/art"&&method==="GET") return ok((await rows("store_products","*,category:store_categories(name)")).map(x=>({...x,category:x.category?.name||"",price:x.price_toman,image_url:x.image_path,active:x.is_available,stock_status:"in_stock"})));
    m=p.match(/^\/admin\/(menu|books|art|events)(?:\/(\d+))?$/);
    if(m&&["POST","PUT","DELETE"].includes(method)){
      const res=m[1],id=m[2];
      if(method==="DELETE"){
        if(res==="menu")await softDelete("cafe_products",id,"is_available");
        else if(res==="books")await softDelete("books",id);
        else if(res==="art")await softDelete("store_products",id,"is_available");
        else {const {error}=await sb.from("events").update({status:"inactive",is_registration_open:false}).eq("id",id);if(error)throw error;}
        return ok({ok:true});
      }
      let table,payload={};
      if(res==="menu"){table="cafe_products";payload={name:body.name,description:body.description||null,price_toman:Number(body.price)||0,image_path:body.image_url||null,is_available:true,sort_order:Number(body.sort)||0,category_id:await categoryId("cafe_categories",body.category)};}
      if(res==="books"){table="books";payload={title:body.title,author:body.author||null,description:body.description||null,sale_price_toman:body.type==="sale"||body.type==="both"?Number(body.price)||0:null,book_type:body.type==="sale"?"sale":body.type==="both"?"both":"loan",available_copies:1,total_copies:1,cover_path:body.image_url||null,is_active:true};}
      if(res==="art"){table="store_products";payload={name:body.name,description:body.description||null,price_toman:Number(body.price)||0,image_path:body.image_url||null,is_available:true,category_id:await categoryId("store_categories",body.category)};}
      if(res==="events"){table="events";payload={title:body.title,description:body.description||null,starts_at:body.event_date||null,event_type:body.event_type||"timed",capacity_people:body.capacity?Number(body.capacity):null,is_registration_open:!!body.registration_open,poster_path:body.image_url||null,status:"published"};}
      if(id){const {data,error}=await sb.from(table).update(payload).eq("id",id).select().single();if(error)throw error;return ok(data);}
      return ok(await single(table,payload));
    }
    if(p==="/admin/events/registrations"&&method==="GET") return ok([]);
    m=p.match(/^\/admin\/books\/(.+)\/return$/);
    if(m&&method==="PUT"){const {data,error}=await sb.rpc("return_book",{p_loan_id:m[1]});if(error)throw error;return ok(data);}

    m=p.match(/^\/admin\/events\/(\d+)\/registrations$/);
    if(m&&method==="GET"){
      const {data,error}=await sb.from("event_registrations").select("*,profile:profiles(display_name),people:event_registration_people(full_name,phone,person_role)").eq("event_id",Number(m[1])).order("created_at",{ascending:true});
      if(error)throw error;return ok((data||[]).map(x=>({full_name:x.registrant_name,phone:x.registrant_phone,people:x.people||[]})));
    }
    if(p==="/admin/forum-topics"&&method==="GET"){
      const {data,error}=await sb.from("forum_topics").select("*,profile:profiles(display_name)").order("created_at",{ascending:false});if(error)throw error;return ok(data||[]);
    }
    throw new Error("این عملیات هنوز در لایه داده پیاده‌سازی نشده است: "+method+" "+p);
  }
  window.SimorghDB={ready:true,sb,phoneE164,api:async(path,opts={})=>{
    try{return await api(path,opts.method||"GET",opts.body?JSON.parse(opts.body):undefined);}
    catch(e){console.error("Supabase:",path,e);return fail(e);}
  }};
})();
