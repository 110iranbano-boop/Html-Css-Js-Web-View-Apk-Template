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
    const [{data:profile,error:pe},{data:roles,error:re},{data:forumPermission,error:fe},{data:adminPermissions,error:ae}] = await Promise.all([
      sb.from("profiles").select("*").eq("id",user.id).maybeSingle(),
      sb.from("user_roles").select("role").eq("user_id",user.id),
      sb.from("forum_permissions").select("can_create_topic").eq("user_id",user.id).maybeSingle(),
      sb.from("admin_permissions").select("permission_key,can_view,can_create,can_update,can_delete").eq("user_id",user.id)
    ]);
    if(pe) throw pe; if(re) throw re; if(fe && fe.code!=="PGRST116") throw fe; if(ae) throw ae;
    const roleRows=roles||[];
    const role=roleRows.some(x=>["super_admin","admin","manager","librarian","cafe_manager","store_manager","event_manager","moderator"].includes(x.role))||(adminPermissions||[]).length?"admin":"user";
    return {authUser:user,profile:profile||{},roles:roleRows,user:{
      id:user.id, phone:profile?.phone || user.phone || user.user_metadata?.phone || "",
      full_name:profile?.display_name || user.user_metadata?.full_name || user.user_metadata?.display_name || "",
      username:profile?.username || "", avatar_url:profile?.avatar_url || "",
      avatar_key:profile?.avatar_key || "", bio:profile?.bio || "",
      role, member_code:"S-"+user.id.slice(0,8).toUpperCase(),
      is_suspended:!!profile?.is_suspended, profile_visibility:profile?.profile_visibility||"private", membership_level_id:profile?.membership_level_id||null,
      can_create_topic:!!profile?.can_create_topic||!!forumPermission?.can_create_topic, is_super_admin:roleRows.some(x=>x.role==="super_admin"), permissions:(adminPermissions||[]).filter(x=>x.can_view).map(x=>x.permission_key)
    }};
  }
  const getProfile = async id => {
    const {data,error}=await sb.from("profiles").select("*").eq("id",id).single();
    if(error) throw error; return data;
  };
  const rows = async (table,select="*",offset=0,limit=999) => {
    const {data,error}=await sb.from(table).select(select).range(offset,offset+limit);
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
    const parts=String(path).split("?"),p=parts[0],params=new URLSearchParams(parts[1]||"");
    const pageOffset=Math.max(0,Number(params.get("offset"))||0),pageLimit=(params.has("offset")||params.has("limit"))?Math.min(100,Math.max(1,Number(params.get("limit"))||24)):999;
    if(p==="/login"&&method==="POST") return ok(await login(body||{}));
    if(p==="/register"&&method==="POST") return ok(await register(body||{}));
    const ctx=await userContext(),uid=ctx.authUser.id;
    if(ctx.profile.is_suspended && method!=="GET" && p!=="/notifications/read") throw new Error("حساب شما تعلیق شده است؛ فقط امکان مشاهده محتوا را دارید");
    if(p==="/cafe-categories"&&method==="GET") return ok((await rows("cafe_categories")).filter(x=>x.is_active).map(x=>({id:x.id,name:x.name,image_url:x.image_path,description:x.description})));
    if(p==="/book-categories"&&method==="GET") return ok((await rows("book_categories")).filter(x=>x.is_active).map(x=>({id:x.id,name:x.name,image_url:x.image_path,description:x.description})));
    if(p==="/store-categories"&&method==="GET") return ok((await rows("store_categories")).filter(x=>x.is_active).map(x=>({id:x.id,name:x.name,image_url:x.image_path,description:x.description})));
    if(p==="/menu"&&method==="GET"){
      const {data,error}=await sb.from("cafe_products").select("*,category:cafe_categories(name)").eq("is_available",true).range(pageOffset,pageOffset+pageLimit);if(error)throw error;
      return ok((data||[]).map(x=>({id:x.id,name:x.name,description:x.description,price:x.price_toman,image_url:x.image_path,category:x.category?.name||"سایر"})));
    }
    if(p==="/books"&&method==="GET"){
      const {data,error}=await sb.from("books").select("*,category:book_categories(name)").eq("is_active",true).range(pageOffset,pageOffset+pageLimit);if(error)throw error;
      return ok((data||[]).map(x=>({id:x.id,title:x.title,author:x.author,description:x.description,category:x.category?.name||"",status:x.available_copies>0?"available":"loaned",price:x.sale_price_toman,image_url:x.cover_path,type:x.book_type})));
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
    if(p==="/loan-extensions/my"&&method==="GET"){
      const {data:myLoans,error:loanError}=await sb.from("book_loans").select("id").eq("user_id",uid);
      if(loanError)throw loanError;
      const loanIds=(myLoans||[]).map(x=>x.id);
      if(!loanIds.length)return ok([]);
      const {data,error}=await sb.from("loan_extensions")
        .select("*,loan:book_loans(id,book_id,current_due_at,returned_at,book:books(title))")
        .in("loan_id",loanIds).order("requested_at",{ascending:false});
      if(error)throw error;
      return ok(data||[]);
    }
    if(p==="/loan-extensions"&&method==="POST"){
      const {data,error}=await sb.from("loan_extensions").insert({loan_id:body.loan_id,status:"pending"}).select().single();if(error)throw error;return ok(data);
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
      const [ev,reg,counts]=await Promise.all([
        sb.from("events").select("*").eq("status","published").order("starts_at",{ascending:true}).range(pageOffset,pageOffset+pageLimit),
        sb.from("event_registrations").select("event_id,people_count,status").eq("user_id",uid),
        sb.from("event_capacity_counts").select("event_id,registered_people")
      ]);
      if(ev.error) throw ev.error;if(reg.error) throw reg.error;if(counts.error) throw counts.error;
      const regs=reg.data||[],countMap=Object.fromEntries((counts.data||[]).map(x=>[x.event_id,x.registered_people]));
      const mapped=(ev.data||[]).map(e=>({id:e.id,title:e.title,description:e.description,event_date:e.starts_at,image_url:e.poster_path,location:e.location||"",capacity:e.capacity_people,required_teammates:e.required_teammates,event_type:e.event_type,registration_open:e.event_type==="timed"&&e.is_registration_open,mine:regs.some(r=>r.event_id===e.id&&r.status==="registered"),registered:countMap[e.id]||0,points:e.award_points_when==="registration"?e.points_on_registration:e.award_points_when==="attendance"?e.points_on_attendance:0,rules_text:e.rules_text}));
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
      const {data,error}=await sb.from("store_products").select("*,category:store_categories(name)").eq("is_available",true).range(pageOffset,pageOffset+pageLimit);if(error)throw error;
      return ok((data||[]).map(x=>({id:x.id,name:x.name,category:x.category?.name||"سایر",description:x.description,price:x.price_toman,image_url:x.image_path,stock_status:x.stock_status||"in_stock",allow_custom:!!x.allow_custom})));
    }
    if(p==="/purchase-requests/my"&&method==="GET"){
      const {data,error}=await sb.from("purchase_requests").select("*,book:books(title),product:store_products(name)").eq("user_id",uid).order("created_at",{ascending:false});
      if(error) throw error;
      return ok((data||[]).map(x=>({id:x.id,status:x.status,created_at:x.created_at,final_price:x.final_price_toman,admin_note:x.admin_note,items:[{title:x.item_name_snapshot,qty:x.quantity,price:x.unit_price_toman_snapshot}]})));
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
      const patch={display_name:String(body.full_name||"").trim(),username:String(body.username||"").trim()||null,bio:String(body.bio||"").trim()||null,avatar_url:String(body.avatar_url||"").trim()||null};if(body.profile_visibility)patch.profile_visibility=body.profile_visibility==="members"?"members":"private";
      const {data,error}=await sb.from("profiles").update(patch).eq("id",uid).select().single();
      if(error) throw error; return ok({...ctx.user,full_name:data.display_name,username:data.username,bio:data.bio,avatar_url:data.avatar_url,profile_visibility:data.profile_visibility});
    }
    if(p==="/admin/purchase-requests"&&method==="GET"){
      const {data,error}=await sb.from("purchase_requests").select("*").order("created_at",{ascending:false}).limit(200);if(error)throw error;
      const ids=[...new Set((data||[]).map(x=>x.user_id))];
      const {data:profiles,error:pe}=ids.length?await sb.from("profiles").select("id,display_name,phone").in("id",ids):{data:[],error:null};if(pe)throw pe;
      const pm=Object.fromEntries((profiles||[]).map(x=>[x.id,x]));
      return ok((data||[]).map(x=>({id:x.id,status:x.status,full_name:pm[x.user_id]?.display_name||"عضو",contact_phone:x.contact_phone||pm[x.user_id]?.phone||"",items:[{title:x.item_name_snapshot,qty:x.quantity,price:x.unit_price_toman_snapshot}],admin_note:x.admin_note,final_price:x.final_price_toman,note:x.note||""})));
    }
    let m=p.match(/^\/admin\/purchase-requests\/([^/]+)$/);
    if(m&&method==="PUT"){
      const patch={}; if(body.status)patch.status=body.status;if("admin_note" in body)patch.admin_note=body.admin_note;if("final_price" in body)patch.final_price_toman=body.final_price===""?null:Number(body.final_price);
      const {error}=await sb.from("purchase_requests").update(patch).eq("id",m[1]);if(error)throw error;return ok({ok:true});
    }
    if(p==="/admin/loan-requests"&&method==="GET"){
      const {data,error}=await sb.from("book_requests").select("id,user_id,book_id,status,proposed_amount_toman,created_at,book:books(title)").eq("request_type","borrow").order("created_at",{ascending:false});if(error)throw error;
      const ids=[...new Set((data||[]).map(x=>x.user_id))];const {data:profiles,error:pe}=ids.length?await sb.from("profiles").select("id,display_name,phone").in("id",ids):{data:[],error:null};if(pe)throw pe;const pm=Object.fromEntries((profiles||[]).map(x=>[x.id,x]));
      return ok((data||[]).map(x=>({id:x.id,book_id:x.book_id,book_title:x.book?.title||"",full_name:pm[x.user_id]?.display_name||"",phone:pm[x.user_id]?.phone||"",status:x.status,proposed_amount_toman:x.proposed_amount_toman})));
    }
    m=p.match(/^\/admin\/loan-requests\/([^/]+)$/);
    if(m&&method==="PUT"){
      const {data,error}=await sb.rpc("review_book_loan_request",{p_request_id:m[1],p_approve:body.status==="approved",p_admin_note:body.admin_note||null});
      if(error)throw error;return ok({id:data});
    }
    if(p==="/admin/active-loans"&&method==="GET"){
      const {data,error}=await sb.from("book_loans").select("*,book:books(title)").is("returned_at",null).order("handed_over_at",{ascending:false});if(error)throw error;
      const ids=[...new Set((data||[]).map(x=>x.user_id))];const {data:profiles,error:pe}=ids.length?await sb.from("profiles").select("id,display_name,phone").in("id",ids):{data:[],error:null};if(pe)throw pe;const pm=Object.fromEntries((profiles||[]).map(x=>[x.id,x]));
      return ok((data||[]).map(x=>({...x,book_title:x.book?.title||"",full_name:pm[x.user_id]?.display_name||"",phone:pm[x.user_id]?.phone||""})));
    }
    m=p.match(/^\/admin\/active-loans\/([^/]+)\/return$/);
    if(m&&method==="PUT"){const {data,error}=await sb.rpc("return_book",{p_loan_id:m[1]});if(error)throw error;return ok(data);}
    if(p==="/admin/loan-extensions"&&method==="GET"){
      const {data,error}=await sb.from("loan_extensions").select("*,loan:book_loans(id,user_id,book:books(title))").order("requested_at",{ascending:false});if(error)throw error;
      const ids=[...new Set((data||[]).map(x=>x.loan?.user_id).filter(Boolean))];const {data:profiles,error:pe}=ids.length?await sb.from("profiles").select("id,display_name,phone").in("id",ids):{data:[],error:null};if(pe)throw pe;const pm=Object.fromEntries((profiles||[]).map(x=>[x.id,x]));
      return ok((data||[]).map(x=>({...x,full_name:pm[x.loan?.user_id]?.display_name||"",phone:pm[x.loan?.user_id]?.phone||"",book_title:x.loan?.book?.title||""})));
    }
    m=p.match(/^\/admin\/loan-extensions\/([^/]+)$/);
    if(m&&method==="PUT"){const {data,error}=await sb.rpc("review_loan_extension",{p_extension_id:m[1],p_approve:body.status==="approved",p_admin_note:body.admin_note||null});if(error)throw error;return ok(data);}
    if(p==="/admin/fines"&&method==="GET"){
      const {data,error}=await sb.from("book_fines").select("*,loan:book_loans(book:books(title))").eq("status","open").order("fine_date",{ascending:false});if(error)throw error;
      const ids=[...new Set((data||[]).map(x=>x.user_id))];const {data:profiles,error:pe}=ids.length?await sb.from("profiles").select("id,display_name,phone").in("id",ids):{data:[],error:null};if(pe)throw pe;const pm=Object.fromEntries((profiles||[]).map(x=>[x.id,x]));
      return ok((data||[]).map(x=>({...x,full_name:pm[x.user_id]?.display_name||"",phone:pm[x.user_id]?.phone||"",book_title:x.loan?.book?.title||""})));
    }
    m=p.match(/^\/admin\/fines\/([^/]+)\/settle$/);
    if(m&&method==="PUT"){const {data,error}=await sb.rpc("settle_user_book_fines",{p_user_id:m[1]});if(error)throw error;return ok({settled:data});}
    if(p==="/admin/book-requests"&&method==="GET"){
      const {data,error}=await sb.from("book_requests").select("*").in("request_type",["suggestion","acquisition"]).order("created_at",{ascending:false});if(error)throw error;
      const ids=[...new Set((data||[]).map(x=>x.user_id))];const {data:profiles,error:pe}=ids.length?await sb.from("profiles").select("id,display_name,phone").in("id",ids):{data:[],error:null};if(pe)throw pe;const pm=Object.fromEntries((profiles||[]).map(x=>[x.id,x]));
      return ok((data||[]).map(x=>({id:x.id,book_title:x.requested_title,author:x.requested_author,description:x.message,full_name:pm[x.user_id]?.display_name||"",phone:pm[x.user_id]?.phone||"",status:x.status,admin_note:x.admin_note})));
    }
    m=p.match(/^\/admin\/book-requests\/([^/]+)$/);
    if(m&&method==="PUT"){
      const patch={};if(body.status)patch.status=body.status;if("admin_note" in body)patch.admin_note=body.admin_note;
      const {error}=await sb.from("book_requests").update({...patch,reviewed_by:uid,reviewed_at:new Date().toISOString()}).eq("id",m[1]);if(error)throw error;return ok({ok:true});
    }
    if(p==="/admin/cafeCats"&&method==="GET") return ok((await rows("cafe_categories")).map(x=>({...x,image_url:x.image_path,active:x.is_active,sort:x.sort_order})));
    if(p==="/admin/bookCats"&&method==="GET") return ok((await rows("book_categories")).map(x=>({...x,image_url:x.image_path,active:x.is_active,sort:x.sort_order})));
    if(p==="/admin/storeCats"&&method==="GET") return ok((await rows("store_categories")).map(x=>({...x,image_url:x.image_path,active:x.is_active,sort:x.sort_order})));
    if(p==="/admin/events"&&method==="GET") return ok((await rows("events")).map(x=>({...x,event_date:x.starts_at,capacity:x.capacity_people,registration_open:x.is_registration_open,image_url:x.poster_path,active:x.status==="published"})));
    if(p==="/admin/books"&&method==="GET") return ok((await rows("books","*,category:book_categories(name)")).flatMap(x=>{const base={...x,category:x.category?.name||"",status:x.available_copies>0?"available":"loaned",price:x.sale_price_toman,total_copies:x.total_copies,image_url:x.cover_path,active:x.is_active};return x.book_type==="both"?[{...base,type:"loan"},{...base,type:"sale"}]:[{...base,type:x.book_type}]}));
    if(p==="/admin/menu"&&method==="GET") return ok((await rows("cafe_products","*,category:cafe_categories(name)")).map(x=>({...x,category:x.category?.name||"",price:x.price_toman,image_url:x.image_path,active:x.is_available})));
    if(p==="/admin/art"&&method==="GET") return ok((await rows("store_products","*,category:store_categories(name)")).map(x=>({...x,category:x.category?.name||"",price:x.price_toman,image_url:x.image_path,active:x.is_available,stock_status:x.stock_status||"in_stock",allow_custom:!!x.allow_custom})));
    m=p.match(/^\/admin\/(menu|books|art|events|cafeCats|bookCats|storeCats)(?:\/(\d+))?$/);
    if(m&&["POST","PUT","DELETE"].includes(method)){
      const res=m[1],id=m[2];
      if(method==="DELETE"){
        if(res==="menu")await softDelete("cafe_products",id,"is_available");
        else if(res==="books")await softDelete("books",id);
        else if(res==="art")await softDelete("store_products",id,"is_available");
        else if(res==="cafeCats")await softDelete("cafe_categories",id);
        else if(res==="bookCats")await softDelete("book_categories",id);
        else if(res==="storeCats")await softDelete("store_categories",id);
        else {const {error}=await sb.from("events").update({status:"inactive",is_registration_open:false}).eq("id",id);if(error)throw error;}
        return ok({ok:true});
      }
      let table,payload={};
      if(res==="menu"){table="cafe_products";payload={name:body.name,description:body.description||null,price_toman:Number(body.price)||0,image_path:body.image_url||null,is_available:true,sort_order:Number(body.sort)||0,category_id:await categoryId("cafe_categories",body.category)};}
      if(res==="cafeCats"){table="cafe_categories";payload={name:body.name,description:body.description||null,image_path:body.image_url||null,sort_order:Number(body.sort)||0,is_active:true};}
      if(res==="bookCats"){table="book_categories";payload={name:body.name,description:body.description||null,image_path:body.image_url||null,sort_order:Number(body.sort)||0,is_active:true};}
      if(res==="storeCats"){table="store_categories";payload={name:body.name,description:body.description||null,image_path:body.image_url||null,sort_order:Number(body.sort)||0,is_active:true};}
      if(res==="books"){table="books";const total=Math.max(0,Number(body.total_copies)||1);let available=total;if(id){const {data:old,error:oe}=await sb.from("books").select("total_copies,available_copies").eq("id",id).single();if(oe)throw oe;const borrowed=Math.max(0,old.total_copies-old.available_copies);if(total<borrowed)throw new Error("تعداد نسخه‌ها نمی‌تواند از تعداد نسخه‌های امانت‌داده‌شده کمتر باشد");available=total-borrowed;}payload={title:body.title,author:body.author||null,description:body.description||null,category_id:await categoryId("book_categories",body.category),sale_price_toman:body.type==="sale"||body.type==="both"?Number(body.price)||0:null,book_type:body.type==="sale"?"sale":body.type==="both"?"both":"loan",available_copies:available,total_copies:total,cover_path:body.image_url||null,is_active:true};}
      if(res==="art"){table="store_products";payload={name:body.name,description:body.description||null,price_toman:Number(body.price)||0,image_path:body.image_url||null,is_available:true,stock_status:body.stock_status||"in_stock",allow_custom:!!body.allow_custom,category_id:await categoryId("store_categories",body.category)};}
      if(res==="events"){table="events";payload={title:body.title,description:body.description||null,starts_at:body.event_date||null,location:body.location||null,event_type:body.event_type||"timed",capacity_people:body.capacity?Number(body.capacity):null,required_teammates:Number(body.required_teammates)||0,points_on_registration:Number(body.points_on_registration)||0,points_on_attendance:Number(body.points_on_attendance)||0,award_points_when:body.award_points_when||"disabled",rules_text:body.rules_text||null,is_registration_open:body.event_type==="weekly"?false:!!body.registration_open,poster_path:body.image_url||null,status:"published"};}
      if(id){
        const {data,error}=await sb.from(table).update(payload).eq("id",id).select().single();if(error)throw error;return ok(data);
      }
      return ok(await single(table,payload));
    }
    if(p==="/admin/events/registrations"&&method==="GET") return ok([]);
    m=p.match(/^\/admin\/event-attendance\/([^/]+)$/);
    if(m&&method==="PUT"){const {data,error}=await sb.rpc("mark_event_attendance",{p_registration_person_id:m[1],p_attendance_status:body.status,p_notes:body.notes||null});if(error)throw error;return ok(data);}
    m=p.match(/^\/admin\/books\/(.+)\/return$/);
    if(m&&method==="PUT"){const {data,error}=await sb.rpc("return_book",{p_loan_id:m[1]});if(error)throw error;return ok(data);}

    m=p.match(/^\/admin\/events\/(\d+)\/registrations$/);
    if(m&&method==="GET"){
      const {data,error}=await sb.from("event_registrations").select("*,people:event_registration_people(id,full_name,phone,person_role)").eq("event_id",Number(m[1])).order("created_at",{ascending:true});
      if(error)throw error;return ok((data||[]).map(x=>({full_name:x.registrant_name,phone:x.registrant_phone,people:x.people||[]})));
    }
    if(p==="/admin/forum-topics"&&method==="GET"){
      const {data,error}=await sb.from("forum_topics").select("*").order("created_at",{ascending:false});
      if(error)throw error;
      const topicRows=data||[];
      const authorIds=[...new Set(topicRows.map(x=>x.user_id).filter(Boolean))];
      const {data:profiles,error:profileError}=authorIds.length
        ? await sb.from("forum_public_profiles")
            .select("id,display_name,username,avatar_url,is_suspended")
            .in("id",authorIds)
        : {data:[],error:null};
      if(profileError)throw profileError;
      const profileMap=Object.fromEntries((profiles||[]).map(x=>[x.id,x]));
      return ok(topicRows.map(x=>({...x,profile:profileMap[x.user_id]||null})));
    }
    throw new Error("این عملیات هنوز در لایه داده پیاده‌سازی نشده است: "+method+" "+p);
  }
  window.SimorghDB={ready:true,sb,phoneE164,api:async(path,opts={})=>{
    try{return await api(path,opts.method||"GET",opts.body?JSON.parse(opts.body):undefined);}
    catch(e){console.error("Supabase:",path,e);return fail(e);}
  }};
})();
